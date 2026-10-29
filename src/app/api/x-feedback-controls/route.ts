import { apiError, HttpError, requireIdentity } from "@/lib/auth";
import { sameOrigin } from "@/lib/security";
import { getXControls, revokeXControls, saveXControls, resolveXControls } from "@/lib/x-feedback-policy";
import { get } from "@/lib/db";
import type { Game } from "@/lib/types";
export async function GET() { try { const user = await requireIdentity(); return Response.json(await getXControls(user.workspace_id), { headers: { "Cache-Control": "private, no-store" } }); } catch (e) { return apiError(e); } }
export async function POST(request: Request) {
  try {
    if (!sameOrigin(request)) throw new HttpError(403, "Use this workspace to review X controls.");
    const user = await requireIdentity(), text = await request.text();
    if (text.length > 4096) throw new HttpError(413, "Request too large.");
    let input: any; try { input = JSON.parse(text); } catch { throw new HttpError(400, "Invalid controls."); }
    if (input?.resolve === true && input?.reviewedChargesAndSettled === true) { await resolveXControls(user.workspace_id); return Response.json(await getXControls(user.workspace_id)); }
    if (input?.revoke === true) { await revokeXControls(user.workspace_id); return Response.json(await getXControls(user.workspace_id)); }
    if (typeof input?.gameId !== "string" || !await get<Game>(user.workspace_id, "game", input.gameId)) throw new HttpError(404, "Game not found.");
    await saveXControls(user.workspace_id, user.id, input); return Response.json(await getXControls(user.workspace_id));
  } catch (e) { return apiError(e); }
}
