import { z } from "zod";
import { bearer } from "@/lib/security";
import { activeJob } from "@/lib/jobs";
import { get, query } from "@/lib/db";
import { apiError, HttpError } from "@/lib/auth";
import { mediaRecord } from "@/lib/media";
import type { Recording, Clip } from "@/lib/types";
import { queueClipCandidate } from "@/lib/game-automation";
import type { Game } from "@/lib/types";
import { after } from "next/server";
import { drainContentAutomation, queueClipDraft } from "@/lib/content-automation";
import { validateGameplayEvidence, gameplayFindings } from "@/lib/gameplay-evidence";
const input = z.object({
  recordingId: z.string().optional(),
  clipId: z.string().optional(),
  status: z.enum(["ready", "failed"]),
  duration: z.number().min(0).max(180).optional(),
  videoUrl: z.string().max(200).optional(),
  screenshotUrl: z.string().max(200).optional(),
  error: z.string().max(300).optional(),
  observations: z
    .array(
      z.object({
        at: z.number().min(0).max(180),
        text: z.string().max(1000),
        type: z.enum(["observation", "hypothesis", "error"]),
        screenshotUrl: z.string().max(200).optional(),
      }),
    )
    .max(50)
    .optional(),
  actions: z.array(z.unknown()).max(100).optional(),
});
export async function POST(request: Request) {
  if (!bearer(request, "WORKER_TOKEN"))
    return new Response(null, { status: 401 });
  try {
    const body = input.parse(await request.json());
    const job = await activeJob(body.clipId || body.recordingId || "");
    const record = await get<Recording | Clip>(
      job.workspace_id,
      job.kind,
      job.id,
    );
    if (!record) throw new HttpError(404, "Job not found.");
    if (body.status === "ready") {
      if (!body.videoUrl)
        throw new HttpError(400, "Ready jobs require a video.");
    }
      const assets = [
        ...(body.videoUrl ? [{url:body.videoUrl,kind:job.kind === "clip" ? "clip" : "video"}] : []),
        ...[body.screenshotUrl,...(body.observations||[]).map(note=>note.screenshotUrl)].filter((url): url is string => !!url).map(url=>({url,kind:"screenshot"})),
      ];
      for (const {url,kind} of assets) {
        const mid = /^\/api\/media\/(media_[a-z0-9]+)$/.exec(url)?.[1];
        const asset = mid
          ? await mediaRecord(job.workspace_id, mid)
          : undefined;
        if (
          !asset || asset.kind !== kind ||
          (job.kind === "clip"
            ? asset.clipId !== job.id
            : asset.recordingId !== job.id)
        )
          throw new HttpError(400, "Job asset does not belong to this run.");
      }
    const next = {
      ...record,
      status: body.status,
      error: body.error,
      videoUrl: body.videoUrl,
      ...(job.kind === "recording"
        ? {
            duration: body.duration,
            screenshotUrl: body.screenshotUrl,
            observations: body.observations || [],
            actions: body.actions || [],
          }
        : {}),
    };
    if (job.kind === "recording") {
      try { validateGameplayEvidence(next as Recording); }
      catch { throw new HttpError(400, "Invalid gameplay evidence."); }
    }
    const findings = job.kind === "recording" ? gameplayFindings(next as Recording) : [];
    // Commit the lease transition, record, findings and gate release in one SQL statement.
    // A failure rolls all of them back, allowing the active worker to retry safely.
    const committed = await query<{id:string}>(`WITH active AS (
      UPDATE jobs j SET state=$4,updated_at=now() WHERE j.id=$1 AND j.workspace_id=$2 AND j.kind=$3 AND j.state='claimed' AND j.lease_until>now()
        AND EXISTS (SELECT 1 FROM records r WHERE r.workspace_id=$2 AND r.kind=$3 AND r.id=$1
          AND ($3<>'recording' OR (r.body->>'gameId'=$6 AND r.body->>'mode'=$7 AND EXISTS (SELECT 1 FROM records g WHERE g.workspace_id=$2 AND g.kind='game' AND g.id=$6)))) RETURNING j.id
    ), saved AS (
      UPDATE records r SET body=$5::jsonb,updated_at=now() WHERE r.workspace_id=$2 AND r.kind=$3 AND r.id=$1 AND EXISTS(SELECT 1 FROM active) RETURNING r.id
    ), inserted AS (
      INSERT INTO records(workspace_id,kind,id,body) SELECT $2,'finding',item->>'id',item FROM jsonb_array_elements($8::jsonb) item WHERE EXISTS(SELECT 1 FROM saved) ON CONFLICT DO NOTHING RETURNING id
    ), released AS (
      UPDATE records SET body=body-'active',updated_at=now() WHERE workspace_id=$2 AND kind='recording_gate' AND id=$6 AND body->>'active'=$1 AND $3='recording' AND EXISTS(SELECT 1 FROM saved) RETURNING id
    ) SELECT id FROM saved`, [job.id,job.workspace_id,job.kind,body.status === "ready" ? "complete" : "failed",JSON.stringify(next),job.kind === "recording" ? (next as Recording).gameId : "",job.kind === "recording" ? (next as Recording).mode : "",JSON.stringify(findings)]);
    if (!committed.length) throw new HttpError(409, "Worker lease expired or job changed.");
    if (job.kind === "recording") {
      const recording = next as Recording;
      try {
        if (recording.status === "ready") {
          const game = await get<Game>(job.workspace_id, "game", recording.gameId);
          if (game) await queueClipCandidate(job.workspace_id, recording, game.title);
        }
      } catch { console.error("Recording follow-up deferred to automation recovery"); }
    }
    if (job.kind === "clip" && next.status === "ready") {
      try {
        if (await queueClipDraft(job.workspace_id, next as Clip)) after(async () => { await drainContentAutomation(); });
      } catch { console.error("Clip follow-up deferred to automation recovery"); }
    }
    return Response.json({ ok: true });
  } catch (e) {
    if (e instanceof z.ZodError)
      return Response.json({ error: "Invalid completion" }, { status: 400 });
    return apiError(e);
  }
}
