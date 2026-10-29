import { smallWorkerBody } from "@/lib/worker-request";
import { HttpError } from "@/lib/http-error";
import { bearer } from "@/lib/security";
import { claimJob } from "@/lib/jobs";
import { apiError } from "@/lib/auth";
export const maxDuration = 60;
export async function POST(request: Request) {
  if (!bearer(request, "WORKER_TOKEN"))
    return new Response(null, { status: 401 });
  try {
    const body = await smallWorkerBody(request);
    const target = body.recordingId;
    if (
      target !== undefined &&
      (typeof target !== "string" || !/^rec_[A-Za-z0-9_-]{1,196}$/.test(target))
    )
      throw new HttpError(400, "Invalid recording target.");
    const job = target
      ? await claimJob(request.headers.get("X-Blaze-Worker-Protocol"), target)
      : await claimJob(request.headers.get("X-Blaze-Worker-Protocol"));
    return Response.json(job, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (e) {
    return apiError(e);
  }
}
