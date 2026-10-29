import { requireIdentity, apiError, HttpError } from "@/lib/auth";
import { get, rateLimit } from "@/lib/db";
import { sameOrigin } from "@/lib/security";
import { requireXFeedbackBudget } from "@/lib/x-feedback-policy";
import { refreshSocialConnection } from "@/lib/social-oauth";
import type { Connection } from "@/lib/types";
export async function POST(request: Request, context: { params: Promise<{ provider: string }> }) {
  try {
    if (!sameOrigin(request)) throw new HttpError(403, "Use this workspace to update an account.");
    const user = await requireIdentity(), text = await request.text();
    if (text.length > 1024) throw new HttpError(413, "Request too large.");
    let connectionId: unknown;
    try { connectionId = JSON.parse(text).connectionId; } catch { throw new HttpError(400, "Invalid connection request."); }
    if (typeof connectionId !== "string" || !/^conn_[a-z0-9]{32}$/.test(connectionId)) throw new HttpError(400, "Invalid connection request.");
    const connection = await get<Connection>(user.workspace_id, "connection", connectionId);
    if (!connection || connection.provider !== (await context.params).provider) throw new HttpError(404, "Connection not found.");
    if (connection.provider === "x_feedback") requireXFeedbackBudget();
    if (!(await rateLimit(`social-refresh:${user.workspace_id}:${connectionId}`, 5, 600))) throw new HttpError(429, "Too many refresh attempts. Try again shortly.");
    return Response.json({ connection: (await refreshSocialConnection(user.workspace_id, connectionId)).connection });
  } catch (error) { return apiError(error); }
}
