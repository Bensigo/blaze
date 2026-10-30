import { randomUUID } from "node:crypto";
import { comparePut, get, query } from "./db";
import { hash } from "./security";
import { tickProductionWatchdog } from "./content-production-watchdog";
import { refreshVideo } from "./content-studio";
import type { VideoProduction } from "./content-studio-contract";

// One normal reconciliation per invocation. The watchdog always has priority.
// The existing importer performs multiple network reads and media validation;
// its execution time is not bounded by this module.
const DEADLINE_MARGIN_MS = 2 * 60 * 1000;

/** Call from a separately configured durable scheduler; this installs no timer. */
export async function tickContentProduction(workspace: string, now = Date.now()) {
  const started = Date.now();
  const watchdog = await tickProductionWatchdog(workspace, now, { maxBatch: 1 });
  if (watchdog.paused || ("busy" in watchdog && watchdog.busy) || !("healthy" in watchdog) || !watchdog.healthy)
    return { watchdog, reconciled: 0 };

  if (Date.now() - started >= 10000) return { watchdog, reconciled: 0 };

  // Order by last completed claim to rotate even when outputs are not yet present.
  // Expired process claims are recovered after two minutes, well beyond the
  // native function lifetime. Importing records only reconcile persisted media;
  // refreshVideo never repeats a partially completed upload.
  const candidates = await query<{ body: VideoProduction }>(`SELECT r.body FROM records r
    LEFT JOIN jobs j ON j.workspace_id=r.workspace_id AND j.kind='content_reconciliation' AND j.body->>'productionId'=r.id
    WHERE r.workspace_id=$1 AND r.kind='video_production' AND r.body->>'state' IN ('running','importing')
    AND (j.id IS NULL OR j.state='complete' OR (j.state='claimed' AND j.lease_until<now())) ORDER BY j.updated_at NULLS FIRST,r.id LIMIT 32`, [workspace]);
  const production = candidates.map(({ body }) => body).find(item => {
    if (item.state === "importing") return true;
    const deadline = Date.parse(item.watchdogDeadlineAt || "");
    return !!item.sessionId && (Boolean(item.stoppedAt) || (Number.isFinite(deadline) && deadline > now + DEADLINE_MARGIN_MS));
  });
  if (!production) return { watchdog, reconciled: 0 };
  const id = `content_reconciliation_${hash(JSON.stringify([workspace, production.id])).slice(0, 32)}`;
  const token = randomUUID();
  const claimed = await query(`INSERT INTO jobs(id,workspace_id,kind,state,body,lease_until) VALUES($1,$2,'content_reconciliation','claimed',jsonb_build_object('token',$3::text,'productionId',$4::text),now()+interval '120 seconds')
    ON CONFLICT(id) DO UPDATE SET state='claimed',body=excluded.body,lease_until=excluded.lease_until,updated_at=now()
    WHERE jobs.workspace_id=excluded.workspace_id AND jobs.kind=excluded.kind AND (jobs.state='complete' OR (jobs.state='claimed' AND jobs.lease_until<now())) RETURNING id`, [id, workspace, token, production.id]);
  if (!claimed.length) return { watchdog, reconciled: 0, busy: true };
  try {
    // Recheck after claiming so a concurrent cancellation or watchdog stop wins.
    const current = await get<VideoProduction>(workspace, "video_production", production.id);
    const deadline = Date.parse(current?.watchdogDeadlineAt || "");
    const eligible = current && (current.state === "importing" || (current.state === "running" && current.sessionId && (current.stoppedAt || (Number.isFinite(deadline) && deadline > Date.now() + DEADLINE_MARGIN_MS))));
    if (!eligible) {
      await query(`UPDATE jobs SET state='complete',updated_at=now() WHERE id=$1 AND body->>'token'=$2 AND state='claimed'`, [id, token]);
      return { watchdog, reconciled: 0 };
    }
    const remaining = 25000 - (Date.now() - started);
    if (remaining < 15000) {
      await query(`UPDATE jobs SET state='complete',updated_at=now() WHERE id=$1 AND body->>'token'=$2 AND state='claimed'`, [id, token]);
      return { watchdog, reconciled: 0 };
    }
    await refreshVideo(workspace, production.id, { signal: AbortSignal.timeout(remaining), maxVideoBytes: 25 * 1024 * 1024 });
    await query(`UPDATE jobs SET state='complete',updated_at=now() WHERE id=$1 AND body->>'token'=$2 AND state='claimed'`, [id, token]);
    return { watchdog, reconciled: 1 };
  } catch {
    // Never record untrusted provider errors or repeat a possibly partial import.
    const current = await get<VideoProduction>(workspace, "video_production", production.id);
    if (current && (current.state === "running" || current.state === "importing")) {
      await comparePut(workspace, "video_production", current, { ...current, ...(current.state === "importing" ? {importStartedAt:current.importStartedAt || current.updatedAt} : {}), state: "needs_reconciliation", error: "Automatic video reconciliation could not be completed. Refresh the video status to review the saved cloud output; do not generate again.", updatedAt: new Date().toISOString() });
    }
    await query(`UPDATE jobs SET state='failed',updated_at=now() WHERE id=$1 AND body->>'token'=$2 AND state='claimed'`, [id, token]);
    return { watchdog, reconciled: 0, reconciliationRequired: true };
  }
}
