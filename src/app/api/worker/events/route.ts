import { bearer } from "@/lib/security";
import { activeJob } from "@/lib/jobs";
import { get } from "@/lib/db";
import { ingest } from "@/lib/telemetry";
import { apiError } from "@/lib/auth";
import type { Recording, Game } from "@/lib/types";
export async function POST(request: Request) {
  if (!bearer(request, "WORKER_TOKEN"))
    return new Response(null, { status: 401 });
  try {
    const body = await request.clone().json();
    const job = await activeJob(body.recordingId);
    const recording = await get<Recording>(
      job.workspace_id,
      "recording",
      job.id,
    );
    if (!recording) return new Response(null, { status: 404 });
    const game = await get<Game>(job.workspace_id, "game", recording.gameId);
    if (!game) return new Response(null, { status: 404 });
    return ingest(request, {
      workspace: job.workspace_id,
      game,
      recordingId: recording.id,
    });
  } catch (e) {
    return apiError(e);
  }
}
