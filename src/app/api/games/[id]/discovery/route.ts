import { apiError, HttpError, requireIdentity } from "@/lib/auth";
import { get, rateLimit } from "@/lib/db";
import { readDiscovery, refreshDiscovery } from "@/lib/discovery-review";
import { sameOrigin } from "@/lib/security";
import type { Game } from "@/lib/types";
type Context = { params: Promise<{ id: string }> };
async function scope(context: Context) {
  const user = await requireIdentity(); const { id } = await context.params;
  const game = id.length <= 100 ? await get<Game>(user.workspace_id, "game", id) : undefined;
  if (!game) throw new HttpError(404, "Game not found.");
  return { workspace: user.workspace_id, game };
}
const headers = { "Cache-Control": "private, no-store" };
export async function GET(_request: Request, context: Context) {
  try { const { workspace, game } = await scope(context); return Response.json({ review: await readDiscovery(workspace, game) || null }, { headers }); } catch (error) { return apiError(error); }
}
export async function POST(request: Request, context: Context) {
  try { if (!sameOrigin(request)) throw new HttpError(403, "Use this workspace to make changes."); const { workspace, game } = await scope(context); if (!await rateLimit(`discovery-refresh:${workspace}`, 6)) throw new HttpError(429, "Too many refresh requests. Try again shortly."); return Response.json({ review: await refreshDiscovery(workspace, game) }, { headers }); } catch (error) { return apiError(error); }
}
