import { requireIdentity, apiError, HttpError } from "@/lib/auth";
import { get } from "@/lib/db";
import { mediaRecord, serveMedia } from "@/lib/media";
import type { VideoProduction } from "@/lib/content-studio-contract";
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireIdentity(); const { id } = await params;
    const production = await get<VideoProduction>(user.workspace_id, "video_production", id);
    if (production?.state !== "ready") throw new HttpError(404, "Video not found.");
    const mediaId = /^\/api\/media\/(media_[a-z0-9]+)$/.exec(production.videoUrl || "")?.[1];
    const media = mediaId ? await mediaRecord(user.workspace_id, mediaId) : undefined;
    if (!media || media.recordingId !== id || media.contentType !== "video/mp4") throw new HttpError(404, "Video not found.");
    const result = await serveMedia(media, request);
    result.headers.set("Content-Disposition", 'attachment; filename="blaze-video.mp4"');
    return result;
  } catch (error) { return apiError(error); }
}
