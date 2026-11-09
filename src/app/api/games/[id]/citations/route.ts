import { apiError, HttpError, requireIdentity } from "@/lib/auth";
import { get, rateLimit } from "@/lib/db";
import { readCitationEvidence, saveCitationEvidence } from "@/lib/citation-evidence";
import { sameOrigin } from "@/lib/security";
import type { Game } from "@/lib/types";
type Context = { params: Promise<{ id: string }> };
async function scope(context: Context) { const user = await requireIdentity(); const { id } = await context.params; const game = id.length <= 100 ? await get<Game>(user.workspace_id,"game",id) : undefined; if (!game) throw new HttpError(404,"Game not found."); return { workspace:user.workspace_id, game }; }
const headers = { "Cache-Control": "private, no-store" };
export async function GET(_request: Request, context: Context) { try { const {workspace,game} = await scope(context); return Response.json({evidence:await readCitationEvidence(workspace,game) || null},{headers}); } catch(error) { return apiError(error); } }
export async function POST(request: Request, context: Context) { try { if (!sameOrigin(request)) throw new HttpError(403,"Use this workspace to make changes."); const {workspace,game}=await scope(context); if (!await rateLimit(`citations:${workspace}`,12)) throw new HttpError(429,"Too many requests."); if (Number(request.headers.get("content-length") || 0) > 8192) throw new HttpError(413,"Request too large."); const text=await request.text(); if (text.length > 8192) throw new HttpError(413,"Request too large."); let body: unknown; try { body=JSON.parse(text); } catch { throw new HttpError(400,"Invalid JSON."); } try { return Response.json({evidence:await saveCitationEvidence(workspace,game,body)},{headers}); } catch(error) { throw new HttpError(400,error instanceof Error ? error.message : "Invalid evidence."); } } catch(error) { return apiError(error); } }
