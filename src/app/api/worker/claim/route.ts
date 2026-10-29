import { bearer } from "@/lib/security";
import { claimJob } from "@/lib/jobs";
import { apiError } from "@/lib/auth";
export const maxDuration = 60;
export async function POST(request: Request) {
  if (!bearer(request, "WORKER_TOKEN"))
    return new Response(null, { status: 401 });
  try {
    return Response.json(await claimJob(request.headers.get("X-Blaze-Worker-Protocol")), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (e) {
    return apiError(e);
  }
}
