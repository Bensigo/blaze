import { query, get, put, id } from "./db";
import type { Game, Recording, Clip } from "./types";
import { HttpError } from "./auth";
import { secretFor } from "./credentials";
import { duePublications } from "./publishing";
import { drainResearch } from "./research-jobs";
export async function enqueue(
  workspace: string,
  kind: "recording" | "clip",
  body: { id: string },
) {
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
export async function workerHeartbeat() {
  await query(
    `INSERT INTO jobs(id,workspace_id,kind,state,body) VALUES('worker-runtime','system','worker_heartbeat','active','{}') ON CONFLICT(id) DO UPDATE SET updated_at=now()`,
  );
}
export async function claimJob() {
  await workerHeartbeat();
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
  }
  // Publish checks are durable and bounded. A crashed tick can resume after its lease; write reservations prevent duplicate posts.
  const tick = await query(
    `INSERT INTO jobs(id,workspace_id,kind,state,body,lease_until) VALUES('publish-tick','system','scheduler','running','{}',now()+interval '1 minute') ON CONFLICT(id) DO UPDATE SET lease_until=excluded.lease_until,updated_at=now() WHERE jobs.lease_until<now() RETURNING id`,
  );
  if (tick.length) await duePublications();
  const rows = await query<{
    id: string;
    workspace_id: string;
    kind: "recording" | "clip";
  }>(
    `UPDATE jobs SET state='claimed',lease_until=now()+interval '2 minutes',updated_at=now() WHERE id=(SELECT id FROM jobs WHERE state='queued' AND kind IN ('recording','clip') AND available_at<=now() ORDER BY available_at FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING id,workspace_id,kind`,
  );
  const row = rows[0];
  if (!row) {
    await drainResearch(1);
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
    const secret = await secretFor(row.workspace_id, "jev");
    return {
      recording,
      game,
      jevKey: recording.mode === "jev" ? secret?.token : undefined,
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
export async function heartbeat(jobId: string) {
  const job = await activeJob(jobId);
  await workerHeartbeat();
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
