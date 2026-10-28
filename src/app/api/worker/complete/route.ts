import { z } from "zod";
import { bearer } from "@/lib/security";
import { activeJob } from "@/lib/jobs";
import { get, put, query } from "@/lib/db";
import { apiError, HttpError } from "@/lib/auth";
import { mediaRecord } from "@/lib/media";
import type { Recording, Clip } from "@/lib/types";
import { queueClipCandidate, releaseRecordingGate } from "@/lib/game-automation";
import type { Game } from "@/lib/types";
import { after } from "next/server";
import { drainContentAutomation, queueClipDraft } from "@/lib/content-automation";
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
      for (const url of [body.videoUrl, body.screenshotUrl].filter(Boolean)) {
        const mid = /^\/api\/media\/(media_[a-z0-9]+)$/.exec(url!)?.[1];
        const asset = mid
          ? await mediaRecord(job.workspace_id, mid)
          : undefined;
        if (
          !asset ||
          (job.kind === "clip"
            ? asset.clipId !== job.id
            : asset.recordingId !== job.id)
        )
          throw new HttpError(400, "Job asset does not belong to this run.");
      }
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
    await put(job.workspace_id, job.kind, next);
    await query(`UPDATE jobs SET state=$2,updated_at=now() WHERE id=$1`, [
      job.id,
      body.status === "ready" ? "complete" : "failed",
    ]);
    if (job.kind === "recording") {
      const recording = next as Recording;
      try {
        await releaseRecordingGate(job.workspace_id, recording.gameId, recording.id);
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
