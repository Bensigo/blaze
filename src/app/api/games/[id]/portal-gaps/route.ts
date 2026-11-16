import { apiError, HttpError, requireIdentity } from "@/lib/auth";
import { get, rateLimit } from "@/lib/db";
import { portalGapInput, readPortalGaps, savePortalGaps } from "@/lib/portal-gaps";
import { sameOrigin } from "@/lib/security";
import type { Game } from "@/lib/types";

type Context = { params: Promise<{ id: string }> };
const response = (body: unknown) => Response.json(body, { headers: { "Cache-Control": "private, no-store" } });
function failure(error: unknown) { const result = apiError(error); result.headers.set("Cache-Control", "private, no-store"); return result; }
async function scope(context: Context) {
  const { workspace_id: workspace } = await requireIdentity();
  const { id } = await context.params;
  const game = /^[a-zA-Z0-9_-]{1,100}$/.test(id) ? await get<Game>(workspace, "game", id) : undefined;
  if (!game || game.storePlatform) throw new HttpError(404, "Game not found.");
  return { workspace, game };
}
async function input(request: Request): Promise<unknown> {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) throw new HttpError(415, "Send a JSON request.");
  if (Number(request.headers.get("content-length")) > 4096) throw new HttpError(413, "Request too large.");
  const reader = request.body?.getReader();
  if (!reader) throw new HttpError(400, "Request is missing.");
  let size = 0; const chunks: Uint8Array[] = [];
  try { while (true) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength; if (size > 4096) { await reader.cancel().catch(() => undefined); throw new HttpError(413, "Request too large."); } chunks.push(value); } } finally { reader.releaseLock(); }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { throw new HttpError(400, "Invalid JSON request."); }
}
export async function GET(_request: Request, context: Context) { try { const { workspace, game } = await scope(context); return response(await readPortalGaps(workspace, game)); } catch (error) { return failure(error); } }
export async function PATCH(request: Request, context: Context) {
  try {
    if (!sameOrigin(request)) throw new HttpError(403, "Use this workspace to edit portal evidence.");
    const { workspace, game } = await scope(context);
    if (!await rateLimit("portal-gap-edit:" + workspace, 30)) throw new HttpError(429, "Too many edits. Try again shortly.");
    const parsed = portalGapInput.safeParse(await input(request));
    if (!parsed.success) throw new HttpError(400, "Check the portal, status and listing URL.");
    return response(await savePortalGaps(workspace, game, parsed.data));
  } catch (error) { return failure(error); }
}
