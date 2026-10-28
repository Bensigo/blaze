import type { Clip, Game, Post, Provider, ProviderSecret } from "../types";
import { api, jsonHeaders, token } from "./common";
import { braveSearch } from "./brave";
import { verifySearchConsole } from "./search-console";
export type MediaInput = {
  bytes?: Uint8Array;
  contentType?: string;
  publicUrl?: string;
};
export type PublicationResult = {
  state: "uploading" | "processing" | "published" | "failed";
  providerId?: string;
  publicationUrl?: string;
  error?: string;
};
export type TikTokConsent = {
  consent: true;
  privacy: string;
  disableComment: boolean;
  disableDuet: boolean;
  disableStitch: boolean;
};
export type PublicationInput = {
  post: Post;
  game: Game;
  clip?: Clip;
  secret: ProviderSecret;
  media?: MediaInput;
  tiktok?: TikTokConsent;
};
const failed = (error: string, providerId?: string): PublicationResult => ({
  state: "failed",
  error,
  providerId,
});
const safeId = (x: unknown) =>
  typeof x === "string" && /^[a-zA-Z0-9_~.:-]{1,200}$/.test(x) ? x : undefined;
const bytes = (media?: MediaInput) => {
  if (!media?.bytes?.length || media.bytes.length > 50_000_000)
    throw new Error(
      "A video of up to 50 MB must be supplied from private storage",
    );
  return Buffer.from(media.bytes);
};
export async function publishPost({
  post,
  game,
  clip,
  secret,
  media,
  tiktok,
}: PublicationInput): Promise<PublicationResult> {
  let dispatched = false;
  try {
    token(secret);
    if (
      post.accountId &&
      secret.accountId &&
      post.accountId !== secret.accountId
    )
      throw new Error(
        "The approved account differs from the connected account",
      );
    if (post.channel === "x") {
      let mediaId: string | undefined;
      if (post.providerId?.startsWith("x-media:"))
        mediaId = safeId(post.providerId.slice(8));
      else if (clip || post.clipId) {
        const video = bytes(media);
        const init = await api(
          "https://api.x.com/2/media/upload/initialize",
          secret,
          {
            method: "POST",
            headers: jsonHeaders,
            body: JSON.stringify({
              media_type: media?.contentType || "video/mp4",
              total_bytes: video.length,
              media_category: "tweet_video",
            }),
          },
        );
        mediaId = safeId(init.data?.id);
        if (!mediaId) throw new Error("X did not return a media upload ID");
        for (
          let offset = 0, index = 0;
          offset < video.length;
          offset += 4 * 1024 * 1024, index++
        ) {
          const form = new FormData();
          form.append("segment_index", String(index));
          form.append(
            "media",
            new Blob([video.subarray(offset, offset + 4 * 1024 * 1024)], {
              type: media?.contentType || "video/mp4",
            }),
            "clip.mp4",
          );
          await api(
            `https://api.x.com/2/media/upload/${mediaId}/append`,
            secret,
            { method: "POST", body: form },
          );
        }
        const final = await api(
          `https://api.x.com/2/media/upload/${mediaId}/finalize`,
          secret,
          { method: "POST" },
        );
        if (final.data?.processing_info?.state === "failed")
          return failed("X video processing failed", `x-media:${mediaId}`);
        return {
          state: "processing",
          providerId: `x-media:${mediaId}`,
          error:
            "Media uploaded; check processing and reserve a separate post step.",
        };
      }
      if ((clip || post.clipId) && !mediaId)
        throw new Error("X media ID is missing");
      dispatched = true;
      const data = await api("https://api.x.com/2/tweets", secret, {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({
          text: post.text,
          ...(mediaId ? { media: { media_ids: [mediaId] } } : {}),
        }),
      });
      const id = safeId(data.data?.id);
      if (!id)
        throw new Error(
          "X did not return a post ID; reconcile before retrying",
        );
      return { state: "processing", providerId: id };
    }
    if (post.channel === "youtube") {
      const video = bytes(media);
      const boundary = `wm-${crypto.randomUUID()}`;
      const metadata = JSON.stringify({
        snippet: { title: clip?.title || game.title, description: post.text },
        status: { privacyStatus: "public" },
      });
      const body = Buffer.concat([
        Buffer.from(
          `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n--${boundary}\r\nContent-Type: ${media?.contentType || "video/mp4"}\r\n\r\n`,
        ),
        video,
        Buffer.from(`\r\n--${boundary}--\r\n`),
      ]);
      dispatched = true;
      const data = await api(
        "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=multipart&part=snippet,status",
        secret,
        {
          method: "POST",
          headers: {
            "Content-Type": `multipart/related; boundary=${boundary}`,
          },
          body,
        },
      );
      const id = safeId(data.id);
      if (!id)
        throw new Error(
          "YouTube did not return a video ID; reconcile before retrying",
        );
      return { state: "processing", providerId: id };
    }
    if (post.channel === "instagram") {
      const account = safeId(secret.accountId);
      if (!account)
        throw new Error("Instagram professional account ID is required");
      if (post.providerId?.startsWith("ig-container:")) {
        const container = safeId(post.providerId.slice(13));
        if (!container) throw new Error("Invalid Instagram container ID");
        dispatched = true;
        const data = await api(
          `https://graph.instagram.com/v24.0/${account}/media_publish`,
          secret,
          {
            method: "POST",
            headers: jsonHeaders,
            body: JSON.stringify({ creation_id: container }),
          },
        );
        const id = safeId(data.id);
        if (!id)
          throw new Error(
            "Instagram did not return a media ID; reconcile before retrying",
          );
        return { state: "processing", providerId: `ig-media:${id}` };
      }
      if (!media?.publicUrl || new URL(media.publicUrl).protocol !== "https:")
        throw new Error(
          "Instagram requires a short-lived HTTPS media URL accessible to Meta",
        );
      dispatched = true;
      const data = await api(
        `https://graph.instagram.com/v24.0/${account}/media`,
        secret,
        {
          method: "POST",
          headers: jsonHeaders,
          body: JSON.stringify({
            media_type: "REELS",
            video_url: media.publicUrl,
            caption: post.text,
          }),
        },
      );
      const id = safeId(data.id);
      if (!id)
        throw new Error(
          "Instagram did not return a container ID; reconcile before retrying",
        );
      return { state: "processing", providerId: `ig-container:${id}` };
    }
    if (post.channel === "tiktok") {
      // Caller must bind these per-post choices and consent to the approval before enabling this path.
      if (tiktok?.consent !== true || !tiktok.privacy)
        throw new Error(
          "TikTok requires creator-info choices and explicit per-post consent before publishing",
        );
      const video = bytes(media);
      const creator = await api(
        "https://open.tiktokapis.com/v2/post/publish/creator_info/query/",
        secret,
        { method: "POST", headers: jsonHeaders, body: "{}" },
      );
      if (!creator.data?.privacy_level_options?.includes(tiktok.privacy))
        throw new Error(
          "Selected TikTok privacy is not available for this creator",
        );
      dispatched = true;
      const data = await api(
        "https://open.tiktokapis.com/v2/post/publish/video/init/",
        secret,
        {
          method: "POST",
          headers: jsonHeaders,
          body: JSON.stringify({
            post_info: {
              title: post.text,
              privacy_level: tiktok.privacy,
              disable_comment: tiktok.disableComment,
              disable_duet: tiktok.disableDuet,
              disable_stitch: tiktok.disableStitch,
            },
            source_info: {
              source: "FILE_UPLOAD",
              video_size: video.length,
              chunk_size: video.length,
              total_chunk_count: 1,
            },
          }),
        },
      );
      const id = safeId(data.data?.publish_id);
      const upload = data.data?.upload_url;
      if (!id || typeof upload !== "string")
        throw new Error(
          "TikTok did not return an upload reservation; reconcile before retrying",
        );
      const uploadUrl = new URL(upload);
      if (
        uploadUrl.protocol !== "https:" ||
        !(
          uploadUrl.hostname === "open-upload.tiktokapis.com" ||
          uploadUrl.hostname.endsWith(".tiktokapis.com")
        )
      )
        return failed("TikTok returned an unexpected upload URL", id);
      try {
        const res = await fetch(uploadUrl, {
          method: "PUT",
          headers: {
            "Content-Type": media?.contentType || "video/mp4",
            "Content-Range": `bytes 0-${video.length - 1}/${video.length}`,
          },
          body: video,
          redirect: "error",
          signal: AbortSignal.timeout(60000),
        });
        if (!res.ok)
          return failed(
            `TikTok upload failed (HTTP ${res.status}); reconcile before retrying`,
            id,
          );
      } catch {
        return {
          state: "processing",
          providerId: id,
          error:
            "TikTok upload outcome is uncertain; reconcile before retrying",
        };
      }
      return { state: "processing", providerId: id };
    }
    return failed("Unsupported channel");
  } catch (e) {
    return dispatched
      ? {
          state: "processing",
          error:
            "Provider request outcome is uncertain; reconcile manually before retrying.",
        }
      : failed(e instanceof Error ? e.message : "Provider request failed");
  }
}
export async function checkPublication({
  post,
  secret,
}: PublicationInput): Promise<PublicationResult> {
  const id = post.providerId;
  if (!id)
    return failed("Provider ID is missing; reconcile manually before retrying");
  try {
    if (post.channel === "x" && id.startsWith("x-media:")) {
      const mediaId = id.slice(8);
      const data = await api(
        `https://api.x.com/2/media/upload?command=STATUS&media_id=${encodeURIComponent(mediaId)}`,
        secret,
      );
      const state = data.data?.processing_info?.state;
      if (state === "failed") return failed("X video processing failed", id);
      return {
        state: "processing",
        providerId: id,
        error:
          state === "succeeded" || (!state && data.data?.id === mediaId)
            ? "Media ready; a separately reserved post step is required."
            : undefined,
      };
    }
    if (post.channel === "x") {
      const data = await api(
        `https://api.x.com/2/tweets/${encodeURIComponent(id)}`,
        secret,
      );
      return data.data?.id === id
        ? {
            state: "published",
            providerId: id,
            publicationUrl: `https://x.com/i/web/status/${id}`,
          }
        : { state: "processing", providerId: id };
    }
    if (post.channel === "youtube") {
      const data = await api(
        `https://www.googleapis.com/youtube/v3/videos?part=status,processingDetails&id=${encodeURIComponent(id)}`,
        secret,
      );
      const item = data.items?.[0];
      if (!item) return { state: "processing", providerId: id };
      if (
        ["failed", "rejected", "deleted"].includes(item.status?.uploadStatus) ||
        item.processingDetails?.processingStatus === "failed"
      )
        return failed("YouTube rejected or failed to process the upload", id);
      return item.processingDetails?.processingStatus === "succeeded" &&
        item.status?.privacyStatus === "public"
        ? {
            state: "published",
            providerId: id,
            publicationUrl: `https://www.youtube.com/watch?v=${id}`,
          }
        : { state: "processing", providerId: id };
    }
    if (post.channel === "instagram") {
      if (id.startsWith("ig-container:")) {
        const container = id.slice(13);
        const data = await api(
          `https://graph.instagram.com/v24.0/${encodeURIComponent(container)}?fields=status_code`,
          secret,
        );
        if (["ERROR", "EXPIRED"].includes(data.status_code))
          return failed(`Instagram container ${data.status_code}`, id);
        return {
          state: "processing",
          providerId: id,
          error:
            data.status_code === "FINISHED"
              ? "Container ready; a separately reserved publish step is required."
              : undefined,
        };
      }
      if (!id.startsWith("ig-media:"))
        return failed("Invalid Instagram publication identifier", id);
      const data = await api(
        `https://graph.instagram.com/v24.0/${encodeURIComponent(id.slice(9))}?fields=id,permalink`,
        secret,
      );
      return data.id && data.permalink
        ? { state: "published", providerId: id, publicationUrl: data.permalink }
        : { state: "processing", providerId: id };
    }
    if (post.channel === "tiktok") {
      const data = await api(
        "https://open.tiktokapis.com/v2/post/publish/status/fetch/",
        secret,
        {
          method: "POST",
          headers: jsonHeaders,
          body: JSON.stringify({ publish_id: id }),
        },
      );
      if (data.data?.status === "FAILED")
        return failed("TikTok processing failed", id);
      if (data.data?.status === "PUBLISH_COMPLETE")
        return { state: "published", providerId: id };
      return { state: "processing", providerId: id };
    }
    return failed("Unsupported channel", id);
  } catch {
    return {
      state: "processing",
      providerId: id,
      error: "Status check failed; retry the check, not the publication.",
    };
  }
}
export async function testConnection(
  provider: Provider | "brave" | "search_console",
  secret: ProviderSecret,
): Promise<{ connected: boolean; accountId?: string; details: string }> {
  try {
    let data: any;
    switch (provider) {
      case "x":
        data = await api("https://api.x.com/2/users/me", secret);
        if (!data.data?.id) throw new Error();
        return {
          connected: true,
          accountId: String(data.data.id),
          details:
            "X account access verified; posting and search scopes are checked when used.",
        };
      case "reddit":
        data = await api("https://oauth.reddit.com/api/v1/me", secret, {
          headers: { "User-Agent": "web-game-marketing/1.0" },
        });
        if (!data.name) throw new Error();
        return {
          connected: true,
          accountId: String(data.name),
          details:
            "Reddit account access verified; search scope is checked when used.",
        };
      case "youtube":
        data = await api(
          "https://www.googleapis.com/youtube/v3/channels?part=id&mine=true",
          secret,
        );
        if (!data.items?.[0]?.id) throw new Error();
        return {
          connected: true,
          accountId: String(data.items[0].id),
          details:
            "YouTube channel access verified; upload scope is checked when used.",
        };
      case "instagram":
        if (!safeId(secret.accountId)) throw new Error();
        data = await api(
          `https://graph.instagram.com/v24.0/${secret.accountId}?fields=id,username`,
          secret,
        );
        if (!data.id) throw new Error();
        return {
          connected: true,
          accountId: String(data.id),
          details:
            "Instagram account access verified; publishing permissions are checked when used.",
        };
      case "tiktok":
        data = await api(
          "https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name",
          secret,
        );
        if (!data.data?.user?.open_id) throw new Error();
        return {
          connected: true,
          accountId: String(data.data.user.open_id),
          details:
            "TikTok account access verified; posting scope and audit are separate.",
        };
      case "anthropic":
        data = await api(
          "https://api.anthropic.com/v1/models?limit=1",
          secret,
          {
            headers: {
              "anthropic-version": "2023-06-01",
              ...(typeof secret.workspaceId === "string"
                ? { "anthropic-workspace-id": secret.workspaceId }
                : {}),
            },
          },
        );
        if (!Array.isArray(data.data)) throw new Error();
        return {
          connected: true,
          details: "Anthropic model listing access verified.",
        };
      case "search_console":
        return verifySearchConsole(secret);
      case "brave":
        await braveSearch("browser games", secret);
        return {
          connected: true,
          details:
            "Brave Web Search access verified; searches use provider quota.",
        };
      case "jev":
        data = await api("https://api.typesafe.ai/v1/models", secret);
        if (!Array.isArray(data.models)) throw new Error();
        return {
          connected: true,
          details:
            "Jev models endpoint access verified; a live decision is not yet verified.",
        };
      default:
        return { connected: false, details: "Provider is not supported." };
    }
  } catch {
    return {
      connected: false,
      details:
        "Provider verification failed. Check the token, account ID, permissions and expiry.",
    };
  }
}
