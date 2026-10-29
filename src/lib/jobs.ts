import { query, get, put, id } from "./db";
import type { Game, Recording, Clip } from "./types";
import { HttpError } from "./http-error";
import { secretFor } from "./credentials";
import { verifyJevModel } from "./ai-settings";
import { duePublications } from "./publishing";
import { drainResearch } from "./research-jobs";
import { drainProfile } from "./game-profile";
import { enqueueRecording, releaseRecordingGate, tickAutomation, PAID_JEV_BLOCKED, paidJevAllowed } from "./game-automation";
import { mintSyntheticCapability } from "./synthetic-capability";
import { drainContentAutomation } from "./content-automation";
import { recordingLimits, workerProtocol, BOUNDED_WORKER_PROTOCOL } from "../../worker/recording-limits";
export async function enqueue(
  workspace: string,
  kind: "recording" | "clip",
  body: { id: string; maxActions?: number; maxDurationSeconds?: number },
) {
  if (kind === "recording" && "gameId" in body && typeof body.gameId === "string") {
    if (!await enqueueRecording(workspace, body as Recording)) throw new HttpError(409, "A recording is already active for this game.");
    return;
  }
  await query(
    `WITH created AS (INSERT INTO records(workspace_id,kind,id,body) VALUES($1,$2,$3,$4::jsonb) RETURNING id) INSERT INTO jobs(id,workspace_id,kind,state,body) SELECT id,$1,$2,'queued',$4::jsonb FROM created`,
    [workspace, kind, body.id, JSON.stringify(body)],
  );
}
export async function activeJob(jobId: string) {
  const row = (
    await query<{
      workspace_id: string;
      kind: "recording" | "clip";
      id: string;
    }>(
      `SELECT id,workspace_id,kind FROM jobs WHERE id=$1 AND state='claimed' AND lease_until>now()`,
      [jobId],
    )
  )[0];
  if (!row)
    throw new HttpError(409, "Worker lease expired or job is not active.");
  return row;
}
export async function workerHeartbeat(protocol?: string | null) {
  const normalized = workerProtocol(protocol);
  await query(
    `INSERT INTO jobs(id,workspace_id,kind,state,body) VALUES('worker-runtime','system','worker_heartbeat','active',$1::jsonb) ON CONFLICT(id) DO UPDATE SET body=excluded.body,updated_at=now()`,
    [JSON.stringify({ protocol: normalized, supportsBoundedRecording: normalized === BOUNDED_WORKER_PROTOCOL })],
  );
}
export async function claimJob(protocol?: string | null) {
  const supportsLimits = workerProtocol(protocol) === BOUNDED_WORKER_PROTOCOL;
  await workerHeartbeat(protocol);
  const stale = await query<{ id: string; workspace_id: string; kind: string }>(
    `UPDATE jobs SET state='failed',updated_at=now() WHERE kind IN ('recording','clip') AND state='claimed' AND lease_until<now() RETURNING id,workspace_id,kind`,
  );
  for (const row of stale) {
    const body = await get<Recording | Clip>(
      row.workspace_id,
      row.kind,
      row.id,
    );
    if (body)
      await put(row.workspace_id, row.kind, {
        ...body,
        status: "failed",
        error:
          "The recording worker stopped responding. Queue a new run after reconnecting it.",
      });
    if (body && row.kind === "recording") await releaseRecordingGate(row.workspace_id, (body as Recording).gameId, body.id);
  }
  await tickAutomation();
  // Publish checks are durable and bounded. A crashed tick can resume after its lease; write reservations prevent duplicate posts.
  const tick = await query(
    `INSERT INTO jobs(id,workspace_id,kind,state,body,lease_until) VALUES('publish-tick','system','scheduler','running','{}',now()+interval '1 minute') ON CONFLICT(id) DO UPDATE SET lease_until=excluded.lease_until,updated_at=now() WHERE jobs.lease_until<now() RETURNING id`,
  );
  if (tick.length) await duePublications();
  const rows = await query<{
    id: string;
    workspace_id: string;
    kind: "recording" | "clip";
    body: unknown;
  }>(
    `UPDATE jobs SET state='claimed',lease_until=now()+interval '2 minutes',updated_at=now() WHERE id=(SELECT id FROM jobs WHERE state='queued' AND kind IN ('recording','clip') AND available_at<=now() AND ($1::boolean OR kind='clip' OR ((body->'maxActions' IS NULL OR body->'maxActions'='30'::jsonb) AND (body->'maxDurationSeconds' IS NULL OR body->'maxDurationSeconds'='30'::jsonb))) ORDER BY available_at FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING id,workspace_id,kind,body`,
    [supportsLimits],
  );
  const row = rows[0];
  if (!row) {
    const auxiliary = (await query<{kind: string}>(`SELECT kind FROM jobs WHERE kind IN ('game_profile','content_draft','research') AND available_at<=now() AND (state='queued' OR (state='claimed' AND lease_until<now())) ORDER BY available_at,id LIMIT 1`))[0];
    if (auxiliary?.kind === "game_profile") await drainProfile();
    else if (auxiliary?.kind === "content_draft") await drainContentAutomation();
    else if (auxiliary?.kind === "research") await drainResearch(1);
    return {};
  }
  if (row.kind === "recording") {
    const recording = await get<Recording>(
      row.workspace_id,
      "recording",
      row.id,
    );
    if (!recording) throw new Error("Missing recording");
    const game = await get<Game>(row.workspace_id, "game", recording.gameId);
    await put(row.workspace_id, "recording", {
      ...recording,
      status: "recording",
      heartbeatAt: new Date().toISOString(),
    });
    let limits: ReturnType<typeof recordingLimits>;
    try {
      limits = recordingLimits(recording);
      const queued = recordingLimits(row.body);
      if (limits.maxActions !== queued.maxActions || limits.maxDurationSeconds !== queued.maxDurationSeconds) throw new Error("Recording limits changed.");
    }
    catch {
      await put(row.workspace_id, "recording", {...recording, status: "failed", error: "Invalid recording limits. Queue a new run."});
      await query("UPDATE jobs SET state='failed',updated_at=now() WHERE id=$1 AND state='claimed'", [row.id]);
      await releaseRecordingGate(row.workspace_id, recording.gameId, recording.id);
      return {};
    }
    if (recording.mode === "jev" && !paidJevAllowed()) {
      await put(row.workspace_id, "recording", {...recording,status:"failed",error:PAID_JEV_BLOCKED});
      await query("UPDATE jobs SET state='failed',updated_at=now() WHERE id=$1 AND state='claimed'",[row.id]);
      await releaseRecordingGate(row.workspace_id,recording.gameId,recording.id);
      return {};
    }
    const secret = recording.mode === "jev" ? await secretFor(row.workspace_id, "jev") : undefined;
    if (recording.mode === "jev") {
      try {
        const pin = recording.jevSelection;
        if (!pin?.connectionId || !pin.model || !pin.settingsRevision || !pin.credentialVersion) throw new Error('This queued recording has no Jev selection. Queue a new run.');
        if (!secret?.token || secret.model !== pin.model || secret.jevConnectionId !== pin.connectionId || secret.jevSettingsRevision !== pin.settingsRevision || secret.jevCredentialVersion !== pin.credentialVersion) throw new Error('Jev settings changed since this recording was queued. Queue a new run.');
        await verifyJevModel(secret.model);
        const latest = await secretFor(row.workspace_id, "jev");
        if (!latest || latest.jevSettingsRevision !== secret.jevSettingsRevision || latest.jevCredentialVersion !== secret.jevCredentialVersion || latest.jevConnectionId !== secret.jevConnectionId || latest.model !== secret.model) throw new Error('Jev settings changed while claiming the job.');
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Jev settings unavailable.';
        await put(row.workspace_id, "recording", {...recording,status:"failed",error:message});
        await query("UPDATE jobs SET state='failed',updated_at=now() WHERE id=$1 AND state='claimed'",[row.id]);
        await releaseRecordingGate(row.workspace_id,recording.gameId,recording.id);
        return {};
      }
    }
    if (!game) throw new Error("Missing game");
    const syntheticCapability = recording.mode === "fixture" ? undefined : await mintSyntheticCapability(row.workspace_id, recording.id, game.id, game.url);
    return {
      recording,
      limits,
      game,
      jevKey: recording.mode === "jev" ? secret?.token : undefined,
      jevModel: recording.mode === "jev" ? secret?.model : undefined,
      syntheticCapability,
    };
  }
  const clip = await get<Clip>(row.workspace_id, "clip", row.id);
  if (!clip) throw new Error("Missing clip");
  return {
    clip,
    recording: await get<Recording>(
      row.workspace_id,
      "recording",
      clip.recordingId,
    ),
    game: await get<Game>(row.workspace_id, "game", clip.gameId),
  };
}
export async function heartbeat(jobId: string, protocol?: string | null) {
  const job = await activeJob(jobId);
  await workerHeartbeat(protocol);
  await query(
    `UPDATE jobs SET lease_until=now()+interval '2 minutes',updated_at=now() WHERE id=$1 AND state='claimed'`,
    [jobId],
  );
  if (job.kind === "recording") {
    const rec = await get<Recording>(job.workspace_id, "recording", jobId);
    if (rec)
      await put(job.workspace_id, "recording", {
        ...rec,
        heartbeatAt: new Date().toISOString(),
      });
  }
  return job;
}
