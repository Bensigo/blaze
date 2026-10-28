import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { bearer, hash } from "@/lib/security";
import { activeJob } from "@/lib/jobs";
import { put } from "@/lib/db";
import { apiError, HttpError } from "@/lib/auth";
export const maxDuration = 60;
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as HandleUploadBody;
    const response = await handleUpload({
      request,
      body,
      onBeforeGenerateToken: async (pathname, payload) => {
        if (!bearer(request, "WORKER_TOKEN"))
          throw new HttpError(401, "Worker authorization required.");
        const data = JSON.parse(payload || "{}");
        const job = await activeJob(data.clipId || data.recordingId);
        if (
          !["video", "screenshot", "clip"].includes(data.kind) ||
          !new RegExp(
            `^worker/${data.recordingId}/[a-zA-Z0-9-]+\\.(webm|png|mp4)$`,
          ).test(pathname)
        )
          throw new HttpError(400, "Invalid asset path.");
        await put(job.workspace_id, "upload_intent", {
          id: hash(pathname),
          pathname,
          recordingId: data.recordingId,
          clipId: data.clipId,
          kind: data.kind,
          expiresAt: Date.now() + 5 * 60000,
        });
        return {
          allowedContentTypes: [
            data.kind === "screenshot"
              ? "image/png"
              : data.kind === "clip"
                ? "video/mp4"
                : "video/webm",
          ],
          maximumSizeInBytes: 150 * 1024 * 1024,
          validUntil: Date.now() + 5 * 60000,
          addRandomSuffix: false,
          allowOverwrite: false,
          tokenPayload: JSON.stringify({
            workspace: job.workspace_id,
            intent: hash(pathname),
          }),
        };
      },
    });
    return Response.json(response);
  } catch (e) {
    return apiError(e);
  }
}
