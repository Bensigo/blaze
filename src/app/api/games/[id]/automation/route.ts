import { z } from "zod";
import { apiError, HttpError, requireIdentity } from "@/lib/auth";
import { get } from "@/lib/db";
import { automationState, setAutomationConfig } from "@/lib/game-automation";
import { sameOrigin } from "@/lib/security";
type Context = { params: Promise<{ id: string }> };
async function scope(context: Context) {
  const user = await requireIdentity(), { id } = await context.params;
  if (id.length > 100 || !await get(user.workspace_id, "game", id)) throw new HttpError(404, "Game not found.");
  return { workspace: user.workspace_id, gameId: id };
}
export async function GET(_request: Request, context: Context) {
  try { const { workspace, gameId } = await scope(context); return Response.json(await automationState(workspace, gameId), { headers: { "Cache-Control": "private, no-store" } }); }
  catch (error) { return apiError(error); }
}
export async function PATCH(request: Request, context: Context) {
  try {
    if (!sameOrigin(request)) throw new HttpError(403, "Use this workspace to make changes.");
    const { workspace, gameId } = await scope(context);
    const text = await request.text();
    if (text.length > 1000) throw new HttpError(413, "Request too large.");
    let body: unknown; try { body = JSON.parse(text); } catch { throw new HttpError(400, "Invalid automation settings."); }
    const parsed = z.object({ enabled: z.boolean().optional(), intervalHours: z.number().int().min(6).max(24).optional() }).strict().safeParse(body);
    if (!parsed.success) throw new HttpError(400, "Invalid automation settings.");
    await setAutomationConfig(workspace, gameId, parsed.data);
    return Response.json(await automationState(workspace, gameId), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return apiError(error); }
}
