import { z } from "zod";
import { apiError, HttpError, requireIdentity } from "@/lib/auth";
import { confirmManualPublication } from "@/lib/manual-export";
import { sameOrigin } from "@/lib/security";
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    if (!sameOrigin(request)) throw new HttpError(403, "Use this workspace to make changes.");
    const user = await requireIdentity(), { id } = await params;
    const raw = await request.text();
    if (raw.length > 5000) throw new HttpError(413, "Request too large.");
    let body: unknown; try { body = JSON.parse(raw); } catch { throw new HttpError(400, "Invalid publication details."); }
    const result = z.object({ publishedAt: z.iso.datetime(), url: z.string().max(2000) }).strict().safeParse(body);
    if (!result.success) throw new HttpError(400, "Invalid publication details.");
    const post = await confirmManualPublication(user.workspace_id, id, user.id, result.data.publishedAt, result.data.url);
    return Response.json({ post }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return apiError(error); }
}
