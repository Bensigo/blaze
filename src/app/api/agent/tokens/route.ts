import { requireIdentity, apiError, HttpError } from "@/lib/auth";
import { issueAgentToken, listAgentTokens, revokeAgentToken } from "@/lib/agent-access";
import { sameOrigin } from "@/lib/security";
import { rateLimit } from "@/lib/db";
import { z } from "zod";
const headers = { "Cache-Control": "private, no-store" };
async function scope(request: Request) {
  if (!sameOrigin(request)) throw new HttpError(403, "Use your workspace to manage agent access.");
  const user = await requireIdentity();
  if (!await rateLimit(`agent-token-admin:${user.workspace_id}`, 20)) throw new HttpError(429, "Too many token changes.");
  if (Number(request.headers.get("content-length") || 0) > 1024) throw new HttpError(413, "Request too large.");
  return user.workspace_id;
}
async function body(request: Request) {
  const text = await request.text();
  if (text.length > 1024) throw new HttpError(413, "Request too large.");
  try { return JSON.parse(text); } catch { throw new HttpError(400, "Invalid JSON."); }
}
export async function GET() {
  try { const user = await requireIdentity(); return Response.json({ tokens: await listAgentTokens(user.workspace_id) }, { headers }); } catch (e) { return apiError(e); }
}
export async function POST(request: Request) {
  try { const workspace = await scope(request); const input = z.object({ name: z.string().trim().min(1).max(80) }).safeParse(await body(request)); if (!input.success) throw new HttpError(400, "Enter a token name (1–80 characters)."); return Response.json(await issueAgentToken(workspace, input.data.name), { headers, status: 201 }); } catch (e) { return apiError(e); }
}
export async function DELETE(request: Request) {
  try { const workspace = await scope(request); const input = z.object({ id: z.string().regex(/^[a-f0-9]{64}$/) }).safeParse(await body(request)); if (!input.success) throw new HttpError(400, "Invalid token id."); await revokeAgentToken(workspace, input.data.id); return Response.json({ revoked: true }, { headers }); } catch (e) { return apiError(e); }
}
