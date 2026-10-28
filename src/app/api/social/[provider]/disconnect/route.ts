import { requireIdentity, apiError, HttpError } from "@/lib/auth";
import { sameOrigin } from "@/lib/security";
import { disconnectSocialConnection } from "@/lib/social-oauth";
export async function POST(request: Request, context: { params: Promise<{ provider: string }> }) {
  try {
    if (!sameOrigin(request)) throw new HttpError(403, "Use this workspace to disconnect an account.");
    const user = await requireIdentity(), text = await request.text();
    if (text.length > 1024) throw new HttpError(413, "Request too large.");
    let connectionId: unknown;
    try { connectionId = JSON.parse(text).connectionId; } catch { throw new HttpError(400, "Invalid connection request."); }
    if (typeof connectionId !== "string" || !/^conn_[a-z0-9]{32}$/.test(connectionId)) throw new HttpError(400, "Invalid connection request.");
    return Response.json(await disconnectSocialConnection(user.workspace_id, (await context.params).provider, connectionId));
  } catch (error) { return apiError(error); }
}
