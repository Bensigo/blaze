import { smallWorkerBody } from "@/lib/worker-request";
import { bearer } from "@/lib/security";
import { activeJob } from "@/lib/jobs";
import { authorizeJevRequest } from "@/lib/jev-budget";
import { apiError, HttpError } from "@/lib/auth";
export async function POST(request: Request) {
  if (!bearer(request, "WORKER_TOKEN"))
    return new Response(null, { status: 401 });
  try {
    const body = await smallWorkerBody(request);
    if (
      typeof body.recordingId !== "string" ||
      !/^[a-zA-Z0-9_-]{1,200}$/.test(body.recordingId)
    )
      throw new HttpError(400, "Invalid recording.");
    const job = await activeJob(body.recordingId);
    if (job.kind !== "recording")
      throw new HttpError(400, "Invalid recording.");
    return Response.json(
      await authorizeJevRequest(job.workspace_id, body.recordingId),
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return apiError(error);
  }
}
