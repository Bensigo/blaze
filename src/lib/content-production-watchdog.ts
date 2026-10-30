import { comparePut, get, query, type TransactionQuery } from "./db";
import { hash } from "./security";
import { secretForConnection } from "./credentials";
import { interruptManagedSession, readManagedSession } from "./managed-gameplay-agent";
import type { Connection } from "./types";
import type { VideoProduction } from "./content-studio-contract";

export const PRODUCTION_RUNTIME_MS = 30 * 60 * 1000;
export const WATCHDOG_FRESHNESS_MS = 90 * 1000;
const WATCHDOG_BATCH = 4;
type WatchdogProvider = { id: string; revision: string; connectionId: string; watchdogVerified: boolean };
export type WatchdogHeartbeat = { id: "default"; configRevision: string; checkedAt: string; healthy: boolean; scanned: number; unresolved: number; error?: string };

/** Immediate dispatch guard: a previous healthy poll cannot mask newer uncertain work. */
export async function unresolvedProduction(workspace: string, excludeId?: string, now = Date.now(), sql: TransactionQuery = query) {
  const rows = await sql<{ body: VideoProduction }>(`SELECT body FROM records WHERE workspace_id=$1 AND kind='video_production' AND ($2::text IS NULL OR id<>$2)
    AND body->>'state' IN ('starting','running','cancel_requested','needs_reconciliation','importing')`, [workspace, excludeId || null]);
  return rows.some(({ body }) => {
    if (["starting", "cancel_requested", "needs_reconciliation"].includes(body.state) || !body.sessionId) return true;
    const deadline = Date.parse(body.watchdogDeadlineAt || "");
    return !body.stoppedAt && (!Number.isFinite(deadline) || deadline <= now);
  });
}

export async function watchdogReady(workspace: string, configRevision: string, now = Date.now()) {
  if (process.env.BLAZE_CLOUD_WATCHDOG_ENABLED !== "true") return false;
  const heartbeat = await get<WatchdogHeartbeat>(workspace, "content_watchdog", "default");
  const at = heartbeat && Date.parse(heartbeat.checkedAt);
  return !!heartbeat && heartbeat.healthy && heartbeat.configRevision === configRevision && typeof at === "number" && Number.isFinite(at) && at <= now + 5000 && now - at <= WATCHDOG_FRESHNESS_MS;
}

async function stopSecret(workspace: string, production: VideoProduction) {
  const config = await get<WatchdogProvider>(workspace, "content_provider", "default");
  const connection = config && await get<Connection>(workspace, "connection", config.connectionId);
  if (!config || config.revision !== production.providerRevision || !connection?.connected || connection.provider !== "anthropic") throw new Error("Producer connection changed; reconcile in Claude.");
  const encrypted = (await query<{ encrypted: string }>("SELECT encrypted FROM credentials WHERE workspace_id=$1 AND provider=$2", [workspace, config.connectionId]))[0]?.encrypted;
  if (!encrypted || hash(encrypted) !== production.credentialRevision) throw new Error("Producer key changed; reconcile in Claude.");
  const secret = await secretForConnection(workspace, config.connectionId);
  if (!secret?.token) throw new Error("Producer key unavailable; reconcile in Claude.");
  return secret;
}

/** A stop operation may only interrupt. It never creates/resumes a session or sends user.message. */
export async function requestProductionStop(workspace: string, productionId: string, reason: "owner_cancel" | "runtime_limit", now = Date.now()): Promise<VideoProduction> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const production = await get<VideoProduction>(workspace, "video_production", productionId);
    if (!production) throw new Error("Video not found.");
    if (["ready", "failed", "cancelled"].includes(production.state)) return production;
    if (production.state === "approved") {
      const cancelled: VideoProduction = { ...production, state: "cancelled", stoppedAt: new Date(now).toISOString(), updatedAt: new Date(now).toISOString(), error: undefined };
      if (await comparePut(workspace, "video_production", production, cancelled)) return cancelled;
      continue;
    }
    // A durable dispatch marker is consumed even if the process dies before the response.
    // The next tick only observes provider state; it cannot repeat the interrupt blindly.
    if (production.stopRequest && production.stopRequest.state !== "pending_session") return production;
    const next: VideoProduction = { ...production, state: "cancel_requested", updatedAt: new Date(now).toISOString(),
      error: reason === "runtime_limit" ? "The 30-minute runtime limit was reached. Cloud stop is pending confirmation." : "Cancellation requested. Cloud execution is not yet confirmed stopped.",
      stopRequest: { id: `stop_${hash(`${workspace}:${productionId}`).slice(0, 32)}`, reason, requestedAt: production.stopRequest?.requestedAt || new Date(now).toISOString(), state: production.sessionId ? "dispatching" : "pending_session" } };
    if (!await comparePut(workspace, "video_production", production, next)) continue;
    if (!production.sessionId) return next;
    let dispatched = false;
    try { await interruptManagedSession(await stopSecret(workspace, production), production.sessionId, 5000); dispatched = true; }
    catch { /* Preserve the reservation: a timeout may mean the interrupt was accepted. */ }
    const current = await get<VideoProduction>(workspace, "video_production", productionId);
    if (!current) throw new Error("Video unavailable after stop request.");
    const sent: VideoProduction = { ...current, stopRequest: { ...next.stopRequest!, state: dispatched ? "requested" : "uncertain" },
      error: dispatched ? next.error : "Cloud stop could not be confirmed. Inspect the session in Claude; no generation or interrupt was retried automatically." };
    if (current.stopRequest?.id === next.stopRequest!.id && current.stopRequest.state === "dispatching" && !["cancelled", "ready", "failed"].includes(current.state)) await comparePut(workspace, "video_production", current, sent);
    return (await get<VideoProduction>(workspace, "video_production", productionId))!;
  }
  throw new Error("Video changed while requesting cancellation. Refresh its status.");
}

/** One bounded poll, invoked by an independently configured authenticated scheduler. No timer is installed here. */
export async function tickProductionWatchdog(workspace: string, now = Date.now()) {
  const config = await get<WatchdogProvider>(workspace, "content_provider", "default");
  if (process.env.BLAZE_CLOUD_WATCHDOG_ENABLED !== "true" || !config?.watchdogVerified) return { paused: true };
  const leaseId = `content_watchdog_${hash(workspace).slice(0, 32)}`;
  const token = new Date(now).toISOString();
  const claimed = await query(`INSERT INTO jobs(id,workspace_id,kind,state,body,lease_until) VALUES($1,$2,'content_watchdog','claimed',jsonb_build_object('token',$3::text),now()+interval '55 seconds')
    ON CONFLICT(id) DO UPDATE SET state='claimed',body=excluded.body,lease_until=excluded.lease_until,updated_at=now()
    WHERE jobs.state IN ('complete','failed') OR jobs.lease_until<now() RETURNING id`, [leaseId, workspace, token]);
  if (!claimed.length) return { paused: false, busy: true };
  let scanned = 0, unresolved = 0;
  try {
    // Only due/uncertain work uses provider reads. Normal running sessions are not polled on every tick.
    // Four records * (one 5s GET + one 5s interrupt) keeps this below the route's 60s limit.
    const candidates = await query<{ body: VideoProduction }>(`SELECT body FROM records WHERE workspace_id=$1 AND kind='video_production'
      AND body->>'state' IN ('starting','running','cancel_requested','needs_reconciliation','importing')
      AND NOT (body ? 'stoppedAt') ORDER BY coalesce(body->>'lastWatchdogAt',body->>'startedAt',''),id`, [workspace]);
    const due = candidates.map(row => row.body).filter(production => {
      const deadline = Date.parse(production.watchdogDeadlineAt || "");
      // Legacy unbounded records are unsafe to assume fresh; require immediate observation/reconciliation.
      const orphanedStart = production.state === "starting" && !production.sessionId && now - Date.parse(production.startedAt || production.updatedAt) >= 60000;
      return orphanedStart || production.state === "cancel_requested" || production.state === "needs_reconciliation" || !Number.isFinite(deadline) || deadline <= now;
    }).sort((a, b) => Number(!!b.sessionId) - Number(!!a.sessionId));
    unresolved += Math.max(0, due.length - WATCHDOG_BATCH);
    unresolved += candidates.filter(({ body }) => body.state === "starting" && !due.includes(body)).length;
    for (const production of due.slice(0, WATCHDOG_BATCH)) {
      scanned++;
      if (!production.sessionId) {
        const marked: VideoProduction = { ...production, state: "needs_reconciliation", error: "The runtime watchdog cannot identify this cloud session. Reconcile in Claude before any new production attempt.", updatedAt: new Date(now).toISOString(), lastWatchdogAt: new Date(now).toISOString() };
        await comparePut(workspace, "video_production", production, marked); unresolved++; continue;
      }
      try {
        const session = await readManagedSession(await stopSecret(workspace, production), production.sessionId, 5000);
        if (session.status === "idle" || session.status === "terminated") {
          const stopped: VideoProduction = { ...production, stoppedAt: new Date(now).toISOString(), updatedAt: new Date(now).toISOString(), lastWatchdogAt: new Date(now).toISOString(),
            ...(production.state === "cancel_requested" ? { state: "cancelled", error: undefined } : {}),
            ...(production.stopRequest ? { stopRequest: { ...production.stopRequest, state: "confirmed" } } : {}) };
          if (!await comparePut(workspace, "video_production", production, stopped)) unresolved++;
          continue;
        }
        const requested = await requestProductionStop(workspace, production.id, production.stopRequest?.reason || "runtime_limit", now);
        await comparePut(workspace, "video_production", requested, { ...requested, lastWatchdogAt: new Date(now).toISOString() });
        unresolved++; // A queued interrupt is never represented as an observed stop.
      } catch {
        const marked: VideoProduction = { ...production, error: "The watchdog could not confirm cloud state. Check the session in Claude; new production is blocked until monitoring recovers.", updatedAt: new Date(now).toISOString(), lastWatchdogAt: new Date(now).toISOString() };
        await comparePut(workspace, "video_production", production, marked); unresolved++;
      }
    }
    const heartbeat: WatchdogHeartbeat = { id: "default", configRevision: config.revision, checkedAt: new Date(now).toISOString(), healthy: unresolved === 0, scanned, unresolved,
      ...(unresolved ? { error: "Cloud stop or reconciliation is pending." } : {}) };
    await query(`INSERT INTO records(workspace_id,kind,id,body) VALUES($1,'content_watchdog','default',$2::jsonb) ON CONFLICT(workspace_id,kind,id) DO UPDATE SET body=excluded.body,updated_at=now()`, [workspace, JSON.stringify(heartbeat)]);
    return { paused: false, ...heartbeat };
  } finally {
    await query(`UPDATE jobs SET state='complete',lease_until=NULL,updated_at=now() WHERE id=$1 AND state='claimed' AND body->>'token'=$2`, [leaseId, token]);
  }
}
