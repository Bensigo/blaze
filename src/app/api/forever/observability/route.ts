import { requireIdentity, apiError } from "@/lib/auth";
import { readSiteObservability } from "@/lib/site-observability";
import { readForeverObservability } from "@/lib/forever-observability";

export async function GET() {
  try {
    const user = await requireIdentity();
    return Response.json(await (process.env.SITE_HEALTH_URL ? readSiteObservability(user.workspace_id) : readForeverObservability(user.workspace_id)), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return apiError(error); }
}
