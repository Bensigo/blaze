import { bearer } from "@/lib/security";
import { heartbeat } from "@/lib/jobs";
import { apiError } from "@/lib/auth";
export async function POST(request: Request) {
  if (!bearer(request, "WORKER_TOKEN"))
    return new Response(null, { status: 401 });
  try {
    const body = await request.json();
    await heartbeat(body.recordingId || body.clipId);
    return Response.json({ ok: true });
  } catch (e) {
    return apiError(e);
  }
}
