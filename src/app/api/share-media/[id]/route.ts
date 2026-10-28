import { verifyMedia } from "@/lib/security";
import { lookupMedia, serveMedia } from "@/lib/media";
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params,
    url = new URL(request.url);
  if (
    !(await verifyMedia(
      id,
      Number(url.searchParams.get("expires")),
      url.searchParams.get("signature") || "",
    ))
  )
    return new Response(null, { status: 403 });
  const row = await lookupMedia(id);
  if (!row) return new Response(null, { status: 404 });
  return serveMedia(row.body, request);
}
