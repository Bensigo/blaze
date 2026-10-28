import { apiError, requireIdentity } from "@/lib/auth";
import { manualExportAsset } from "@/lib/manual-export";
import { serveMedia } from "@/lib/media";
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireIdentity(), { id } = await params;
    const asset = await manualExportAsset(user.workspace_id, id);
    const response = await serveMedia(asset, request);
    response.headers.set("Content-Disposition", `attachment; filename="game-clip.${asset.contentType === "video/mp4" ? "mp4" : "webm"}"`);
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  } catch (error) { return apiError(error); }
}
