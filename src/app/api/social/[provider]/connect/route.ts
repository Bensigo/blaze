import { requireIdentity, apiError, HttpError } from "@/lib/auth";
import { rateLimit } from "@/lib/db";
import { sameOrigin } from "@/lib/security";
import { beginSocialAuthorization } from "@/lib/social-oauth";
export async function POST(request: Request, context: { params: Promise<{ provider: string }> }) {
  try {
    if (!sameOrigin(request)) throw new HttpError(403, "Use this workspace to connect an account.");
    const user = await requireIdentity();
    if (!(await rateLimit(`social-connect:${user.id}`, 12, 600))) throw new HttpError(429, "Too many connection attempts. Try again shortly.");
    const text = await request.text();
    if (text.length > 1024) throw new HttpError(413, "Request too large.");
    let body: { connectionId?: string };
    try { body = text ? JSON.parse(text) : {}; } catch { throw new HttpError(400, "Invalid connection request."); }
    if (!body || typeof body !== "object" || (body.connectionId !== undefined && (typeof body.connectionId !== "string" || !/^conn_[a-z0-9]{32}$/.test(body.connectionId)))) throw new HttpError(400, "Invalid connection request.");
    return Response.json({ url: await beginSocialAuthorization(user, (await context.params).provider, request, body.connectionId) });
  } catch (error) { return apiError(error); }
}
