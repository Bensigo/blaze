import { requireIdentity, apiError } from "@/lib/auth";
import { readSiteObservability } from "@/lib/site-observability";
export async function GET() {
  try { const user = await requireIdentity(); return Response.json(await readSiteObservability(user.workspace_id), {headers:{"Cache-Control":"private, no-store"}}); }
  catch (error) { return apiError(error); }
}
