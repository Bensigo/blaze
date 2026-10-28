import { bearer } from "@/lib/security";
import { claimJob } from "@/lib/jobs";
import { apiError } from "@/lib/auth";
export async function POST(request: Request) {
  if (!bearer(request, "WORKER_TOKEN"))
    return new Response(null, { status: 401 });
  try {
    return Response.json(await claimJob(), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (e) {
    return apiError(e);
  }
}
