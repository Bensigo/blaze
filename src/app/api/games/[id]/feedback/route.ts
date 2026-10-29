import { apiError, HttpError, requireIdentity } from "@/lib/auth";
import { get, rateLimit } from "@/lib/db";
import { sameOrigin } from "@/lib/security";
import { collectFeedback, readFeedback } from "@/lib/x-feedback";
import type { Game } from "@/lib/types";
type Context = { params: Promise<{ id: string }> };
async function scope(context: Context) {
  const user = await requireIdentity(), { id } = await context.params;
  const game = id.length <= 100 ? await get<Game>(user.workspace_id, "game", id) : undefined;
  if (!game) throw new HttpError(404, "Game not found.");
  return { workspace: user.workspace_id, game };
}
const headers = { "Cache-Control": "private, no-store" };
export async function GET(_request: Request, context: Context) {
  try { const { workspace, game } = await scope(context); return Response.json(await readFeedback(workspace, game), { headers }); } catch (error) { return apiError(error); }
}
export async function POST(request: Request, context: Context) {
  try {
    if (!sameOrigin(request)) throw new HttpError(403, "Use this workspace to collect feedback.");
    const { workspace, game } = await scope(context);
    const text = await request.text(); if (text.length > 1024) throw new HttpError(413, "Request too large.");
    let body: any; try { body = JSON.parse(text); } catch { throw new HttpError(400, "Invalid request."); }
    if (!body || body.confirmSearchAndCost !== true) throw new HttpError(400, "Confirm this one X search and its possible cost before collecting.");
    if (!await rateLimit(`x-feedback:${workspace}`, 6, 3600)) throw new HttpError(429, "Too many feedback searches. Try later.");
    return Response.json(await collectFeedback(workspace, game), { headers });
  } catch (error) { return apiError(error); }
}
