import { head } from "@vercel/blob";
import { bearer, hash } from "@/lib/security";
import { activeJob } from "@/lib/jobs";
import { id, get, put } from "@/lib/db";
import { saveAsset, type MediaRecord } from "@/lib/media";
import { apiError, HttpError } from "@/lib/auth";
export const maxDuration = 60;
export async function POST(request: Request) {
  if (!bearer(request, "WORKER_TOKEN"))
    return new Response(null, { status: 401 });
  try {
    if (request.headers.get("content-type")?.includes("application/json")) {
      const body = await request.json();
      const job = await activeJob(body.clipId || body.recordingId);
      const intent = await get<{
        id: string;
        pathname: string;
        recordingId: string;
        clipId?: string;
        kind: string;
        expiresAt: number;
      }>(job.workspace_id, "upload_intent", hash(String(body.pathname)));
      if (
        !intent ||
        intent.expiresAt < Date.now() ||
        intent.recordingId !== body.recordingId ||
        intent.clipId !== body.clipId ||
        intent.kind !== body.kind
      )
        throw new HttpError(
          400,
          "Upload authorization expired or did not match.",
        );
      const meta = await head(body.blobUrl);
      if (
        meta.pathname !== intent.pathname ||
        meta.size > 150 * 1024 * 1024 ||
        !["image/png", "video/webm", "video/mp4"].includes(meta.contentType)
      )
        throw new HttpError(400, "Uploaded asset did not match.");
      const mid = `media_${hash(intent.pathname).slice(0, 32)}`;
      await put<MediaRecord>(job.workspace_id, "media", {
        id: mid,
        recordingId: intent.recordingId,
        clipId: intent.clipId,
        kind: intent.kind,
        location: meta.url,
        contentType: meta.contentType,
        size: meta.size,
        backend: "blob",
        createdAt: new Date().toISOString(),
      });
      return Response.json({ url: `/api/media/${mid}` });
    }
    if (
      process.env.VERCEL &&
      Number(request.headers.get("content-length") || 0) > 4 * 1024 * 1024
    )
      throw new HttpError(413, "Use direct Blob upload for large assets.");
    const form = await request.formData();
    const recordingId = String(form.get("recordingId") || ""),
      clipId = form.get("clipId") ? String(form.get("clipId")) : undefined,
      kind = String(form.get("kind"));
    const job = await activeJob(clipId || recordingId);
    const file = form.get("file");
    if (!(file instanceof File) || file.size > 150 * 1024 * 1024)
      throw new HttpError(400, "Asset file is missing or too large.");
    return Response.json({
      url: await saveAsset(job.workspace_id, recordingId, kind, file, clipId),
    });
  } catch (e) {
    return apiError(e);
  }
}
