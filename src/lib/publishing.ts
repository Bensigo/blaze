import { hash, signMedia } from "./security";
import { get, comparePut, query } from "./db";
import { secretFor } from "./credentials";
import { mediaRecord, mediaBytes } from "./media";
import { publishPost, checkPublication } from "./integrations";
import type { Post, Game, Clip } from "./types";
import type { PublicationInput } from "./integrations";
import { HttpError } from "./auth";
export const approvalHash = (p: Post) =>
  hash(
    JSON.stringify({
      game: p.gameId,
      clip: p.clipId || "",
      channel: p.channel,
      text: p.text,
      account: p.accountId,
      time: p.scheduledAt || "",
      tiktok: p.tiktokConsent || null,
    }),
  );
export function approvalValid(post: Post) {
  return (
    !!post.approvedAt &&
    !!post.approvedBy &&
    post.approvedHash === approvalHash(post)
  );
}
async function input(workspace: string, post: Post): Promise<PublicationInput> {
  const game = await get<Game>(workspace, "game", post.gameId);
  if (!game) throw new HttpError(404, "Game not found.");
  const secret = await secretFor(workspace, post.channel, post.accountId);
  if (!secret)
    throw new HttpError(
      400,
      "Connect and verify the approved destination account first.",
    );
  const clip = post.clipId
    ? await get<Clip>(workspace, "clip", post.clipId)
    : undefined;
  let media: PublicationInput["media"];
  if (post.clipId) {
    if (!clip || clip.status !== "ready" || !clip.videoUrl)
      throw new HttpError(400, "The selected clip is not ready.");
    const mid = /^\/api\/media\/(media_[a-z0-9]+)$/.exec(clip.videoUrl)?.[1];
    if (!mid) throw new HttpError(400, "Clip media is unavailable.");
    const asset = await mediaRecord(workspace, mid);
    if (!asset) throw new HttpError(404, "Clip media not found.");
    const expires = Date.now() + 30 * 60000;
    media = {
      bytes: await mediaBytes(asset),
      contentType: asset.contentType,
      publicUrl: `${process.env.APP_URL}/api/share-media/${mid}?expires=${expires}&signature=${await signMedia(mid, expires)}`,
    };
  }
  return { post, game, clip, secret, media, tiktok: post.tiktokConsent };
}
async function reserve(workspace: string, post: Post, phase: string) {
  return (
    (
      await query(
        `INSERT INTO publish_dispatches(workspace_id,post_id,approval_hash,state) VALUES($1,$2,$3,'reserved') ON CONFLICT DO NOTHING RETURNING post_id`,
        [workspace, post.id, `${post.approvedHash}:${phase}`],
      )
    ).length > 0
  );
}
async function recordResult(
  workspace: string,
  post: Post,
  result: Awaited<ReturnType<typeof publishPost>>,
) {
  const updated = {
    ...post,
    status: result.state,
    providerId: result.providerId || post.providerId,
    publicationUrl: result.publicationUrl,
    error: result.error,
  };
  if (!(await comparePut(workspace, "post", post, updated)))
    throw new HttpError(
      409,
      "The post changed while its provider result arrived. Reconcile the saved publication.",
    );
  return updated;
}
export async function dispatch(
  workspace: string,
  postId: string,
  manual = false,
) {
  if (process.env.PUBLISHING_ENABLED !== "true")
    throw new HttpError(
      400,
      "Live publishing is disabled. Enable it after configuring and validating channel access.",
    );
  const post = await get<Post>(workspace, "post", postId);
  if (!post) throw new HttpError(404, "Post not found.");
  if (!approvalValid(post))
    throw new HttpError(
      409,
      "This post needs approval for its current content and schedule.",
    );
  if (!["approved", "scheduled"].includes(post.status))
    throw new HttpError(
      409,
      "Publication is already in progress or finished. Check its current status.",
    );
  if (post.scheduledAt && new Date(post.scheduledAt).getTime() > Date.now())
    throw new HttpError(
      409,
      "This approved post is scheduled for later. Edit the time and approve again to change it.",
    );
  const prepared = await input(workspace, post);
  const locked: Post = { ...post, status: "uploading" };
  if (!(await comparePut(workspace, "post", post, locked)))
    throw new HttpError(
      409,
      "The post changed before dispatch. Review it again.",
    );
  if (!(await reserve(workspace, post, "initial"))) {
    await comparePut(workspace, "post", locked, {
      ...locked,
      error:
        "A publication request already exists. Reconcile the provider state before retrying.",
    });
    throw new HttpError(
      409,
      "A publication request already exists. Reconcile its provider status before retrying.",
    );
  }
  return recordResult(workspace, locked, await publishPost(prepared));
}
export async function reconcile(workspace: string, post: Post) {
  if (!approvalValid(post)) return post;
  if (!post.providerId) return post; // An uncertain write without a provider ID is never retried.
  const prepared = await input(workspace, post);
  const result = await checkPublication(prepared);
  if (
    result.state === "processing" &&
    result.error?.includes("separately reserved") &&
    process.env.PUBLISHING_ENABLED === "true"
  ) {
    const locked: Post = { ...post, status: "uploading" };
    if (!(await comparePut(workspace, "post", post, locked))) return post;
    if (!(await reserve(workspace, post, "publication"))) {
      await comparePut(workspace, "post", locked, {
        ...locked,
        error:
          "Publication outcome needs manual reconciliation. No further write will be sent.",
      });
      return locked;
    }
    return recordResult(workspace, locked, await publishPost(prepared));
  }
  return recordResult(workspace, post, result);
}
export async function duePublications() {
  if (process.env.PUBLISHING_ENABLED !== "true") return { checked: 0 };
  const rows = await query<{ workspace_id: string; body: Post }>(
    `SELECT workspace_id,body FROM records WHERE kind='post' AND ((body->>'status'='processing' AND body->>'providerId' IS NOT NULL) OR (body->>'status'='scheduled' AND (body->>'scheduledAt')::timestamptz<=now())) ORDER BY updated_at LIMIT 1`,
  );
  let checked = 0;
  for (const row of rows) {
    try {
      if (row.body.status === "processing")
        await reconcile(row.workspace_id, row.body);
      else await dispatch(row.workspace_id, row.body.id);
      checked++;
    } catch (error) {
      if (
        error instanceof HttpError &&
        error.status === 400 &&
        row.body.status === "scheduled"
      )
        await comparePut(row.workspace_id, "post", row.body, {
          ...row.body,
          status: "failed",
          error: error.message,
        });
      else if (row.body.status === "processing")
        await comparePut(row.workspace_id, "post", row.body, {
          ...row.body,
          error:
            error instanceof HttpError
              ? error.message
              : "Status check failed. Verify the connection and media before checking again.",
        });
    }
  }
  return { checked };
}
