import { after } from "next/server";
import { z } from "zod";
import { apiError, HttpError, requireIdentity } from "@/lib/auth";
import { get, rateLimit } from "@/lib/db";
import { drainProfile, queueProfile, readProfile, updateProfileOverrides } from "@/lib/game-profile";
import { publicOrigin, sameOrigin } from "@/lib/security";

const overrides = z.object({
  description: z.string().max(1000).optional(),
  genre: z.string().max(1000).optional(),
  audience: z.string().max(1000).optional(),
  rules: z.string().max(1000).optional(),
  controls: z.string().max(1000).optional(),
}).strict();
type Context = { params: Promise<{ id: string }> };
async function scope(context: Context) {
  const user = await requireIdentity();
  const { id } = await context.params;
  if (id.length > 100 || !await get(user.workspace_id, "game", id)) throw new HttpError(404, "Game not found.");
  return { workspace: user.workspace_id, gameId: id };
}
export async function GET(_request: Request, context: Context) {
  try { const { workspace, gameId } = await scope(context); return Response.json(await readProfile(workspace, gameId), { headers: { "Cache-Control": "private, no-store" } }); }
  catch (error) { return apiError(error); }
}
export async function PATCH(request: Request, context: Context) {
  try {
    if (!sameOrigin(request)) throw new HttpError(403, "Use this workspace to make changes.");
    const { workspace, gameId } = await scope(context);
    const text = await request.text();
    if (text.length > 10000) throw new HttpError(413, "Request too large.");
    let body: unknown;
    try { body = JSON.parse(text); } catch { throw new HttpError(400, "Invalid profile fields."); }
    const parsed = z.object({ overrides }).strict().safeParse(body);
    if (!parsed.success) throw new HttpError(400, "Invalid profile fields.");
    await updateProfileOverrides(workspace, gameId, parsed.data.overrides);
    return Response.json(await readProfile(workspace, gameId), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return apiError(error); }
}
export async function POST(request: Request, context: Context) {
  try {
    if (!sameOrigin(request)) throw new HttpError(403, "Use this workspace to make changes.");
    const { workspace, gameId } = await scope(context);
    if (!await rateLimit(`profile-refresh:${workspace}`, 6)) throw new HttpError(429, "Too many refresh requests. Try again shortly.");
    const jobId = await queueProfile(workspace, gameId, publicOrigin(request));
    try { after(async () => { await drainProfile(jobId); }); } catch { /* The durable job remains for the worker or cron. */ }
    return Response.json(await readProfile(workspace, gameId), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return apiError(error); }
}
