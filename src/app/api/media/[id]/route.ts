import { identity, apiError } from "@/lib/auth";
import { lookupMedia, serveMedia } from "@/lib/media";
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const user = await identity();
    if (!user)
      return new Response(null, { status: 401 });
    const row = await lookupMedia(id);
    if (!row || (user && row.workspace_id !== user.workspace_id))
      return new Response(null, { status: 404 });
    if (row.body.captureId && !user) return new Response(null, { status: 401 });
    return serveMedia(row.body, request);
  } catch (e) {
    return apiError(e);
  }
}
