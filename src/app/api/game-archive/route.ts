import { z } from "zod";
import { requireIdentity, apiError, HttpError } from "@/lib/auth";
import { sameOrigin } from "@/lib/security";
import { rateLimit } from "@/lib/db";
import { archiveGame, archivedGames, restoreGame } from "@/lib/game-archive";
const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("delete"), gameId: z.string().min(1).max(100), confirmation: z.string().min(1).max(500) }).strict(),
  z.object({ action: z.literal("restore"), gameId: z.string().min(1).max(100) }).strict(),
]);
export async function GET() {
  try { const user = await requireIdentity(); return Response.json({ games: await archivedGames(user.workspace_id) }, { headers: { "Cache-Control": "private, no-store" } }); }
  catch (error) { return apiError(error); }
}
export async function POST(request: Request) {
  try {
    if (!sameOrigin(request)) throw new HttpError(403, "Use this workspace to make changes.");
    const user = await requireIdentity();
    if (!await rateLimit(`game-archive:${user.workspace_id}`, 20)) throw new HttpError(429, "Too many requests.");
    const reader = request.body?.getReader(); if (!reader) throw new HttpError(400, "Missing request.");
    const chunks: Uint8Array[] = []; let size = 0;
    for (;;) { const part = await reader.read(); if (part.done) break; size += part.value.byteLength; if (size > 4096) { await reader.cancel(); throw new HttpError(413, "Request too large."); } chunks.push(part.value); }
    const body = schema.parse(JSON.parse(Buffer.concat(chunks, size).toString("utf8")));
    return Response.json({ result: body.action === "delete" ? await archiveGame(user.workspace_id, body.gameId, body.confirmation, user.id) : await restoreGame(user.workspace_id, body.gameId) });
  } catch (error) { if (error instanceof z.ZodError || error instanceof SyntaxError) return Response.json({ error: "Check the game name and try again." }, { status: 400 }); return apiError(error); }
}
