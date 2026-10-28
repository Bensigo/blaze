import { z } from "zod";
import { requireIdentity, apiError, HttpError } from "@/lib/auth";
import {
  get,
  list,
  put,
  comparePut,
  remove,
  query,
  id,
  rateLimit,
} from "@/lib/db";
import { sameOrigin, publicOrigin } from "@/lib/security";
import { saveSecret, secretFor } from "@/lib/credentials";
import { gameMetadata, imageUrl } from "@/lib/metadata";
import { enqueue } from "@/lib/jobs";
import { researchJob } from "@/lib/research-jobs";
import { draftContent, testConnection } from "@/lib/integrations";
import { approvalHash, dispatch, reconcile } from "@/lib/publishing";
import type {
  Game,
  Post,
  Clip,
  Recording,
  Finding,
  Connection,
  Provider,
  ProviderSecret,
  Channel,
} from "@/lib/types";
import { analytics } from "@/lib/analytics";
const str = z.string().trim().min(1).max(500);
const rid = z.string().max(100);
const channel = z.enum(["x", "youtube", "instagram", "tiktok"]);
const tiktokSchema = z.object({
  consent: z.literal(true),
  privacy: z.string().max(60),
  disableComment: z.boolean(),
  disableDuet: z.boolean(),
  disableStitch: z.boolean(),
});
const postFields = z.object({
  gameId: rid,
  clipId: rid.optional(),
  channel,
  text: z.string().trim().min(1).max(5000),
  accountId: z.string().max(200),
  scheduledAt: z.iso.datetime().nullish(),
  tiktokConsent: tiktokSchema.optional(),
});
async function creator(workspace: string, accountId: string) {
  const secret = await secretFor(workspace, "tiktok", accountId);
  if (!secret) throw new HttpError(400, "Connect this TikTok account first.");
  const response = await fetch(
    "https://open.tiktokapis.com/v2/post/publish/creator_info/query/",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secret.token}`,
        "Content-Type": "application/json",
      },
      body: "{}",
      redirect: "error",
      signal: AbortSignal.timeout(10000),
    },
  );
  if (!response.ok)
    throw new HttpError(
      400,
      "TikTok creator information could not be retrieved. Check the video.publish scope.",
    );
  const body = await response.json(),
    d = body.data;
  if (body.error?.code !== "ok" || !d?.privacy_level_options)
    throw new HttpError(
      400,
      "TikTok creator publishing permissions are unavailable.",
    );
  return {
    privacyOptions: d.privacy_level_options as string[],
    commentDisabled: !!d.comment_disabled,
    duetDisabled: !!d.duet_disabled,
    stitchDisabled: !!d.stitch_disabled,
    maxDuration: Number(d.max_video_post_duration_sec),
    username: String(d.creator_username || ""),
  };
}
export async function POST(request: Request) {
  try {
    if (!sameOrigin(request))
      throw new HttpError(403, "Use this workspace to make changes.");
    const user = await requireIdentity(),
      workspace = user.workspace_id;
    if (Number(request.headers.get("content-length") || 0) > 32000)
      throw new HttpError(413, "Request too large.");
    const text = await request.text();
    if (text.length > 32000) throw new HttpError(413, "Request too large.");
    const body = JSON.parse(text);
    const action = z.string().max(50).parse(body.action);
    if (!(await rateLimit(`actions:${workspace}`, 120)))
      throw new HttpError(429, "Too many requests. Try again shortly.");
    const requireRecord = async <T>(kind: string, key: unknown) => {
      const item = await get<T>(workspace, kind, rid.parse(key));
      if (!item) throw new HttpError(404, `${kind} not found.`);
      return item;
    };
    if (action === "add_game") {
      const v = z
        .object({
          url: z.string().max(2000),
          title: z.string().max(120).optional(),
          image: z.string().max(2000).optional(),
          genre: z.string().max(80).optional(),
        })
        .parse(body);
      const metadata = await gameMetadata(v.url, publicOrigin(request));
      const game: Game = {
        ...metadata,
        id: id("game"),
        title: v.title || metadata.title,
        image: v.image ? imageUrl(v.image, metadata.url) : metadata.image,
        genre: v.genre || "Web game",
        sdkKey: id("sdk"),
        origins: [new URL(metadata.url).origin],
        createdAt: new Date().toISOString(),
        dailyEnabled: true,
        competitors: [],
      };
      await put(workspace, "game", game);
      return Response.json({ game });
    }
    if (action === "update_game") {
      const game = await requireRecord<Game>("game", body.id);
      const v = z
        .object({
          title: z.string().trim().min(1).max(120).optional(),
          description: z.string().max(500).optional(),
          image: z.string().max(2000).optional(),
          genre: z.string().max(80).optional(),
          origins: z.array(z.string().url()).max(10).optional(),
          competitors: z.array(z.string().url()).max(5).optional(),
          dailyEnabled: z.boolean().optional(),
        })
        .parse(body);
      const origins = v.origins?.map((s) => {
        const u = new URL(s);
        if (
          !["http:", "https:"].includes(u.protocol) ||
          u.username ||
          u.password
        )
          throw new HttpError(400, "Use HTTP(S) origins.");
        return u.origin;
      });
      await put(workspace, "game", {
        ...game,
        ...v,
        ...(origins ? { origins } : {}),
        image: v.image === undefined ? game.image : imageUrl(v.image, game.url),
      });
      return Response.json({ ok: true });
    }
    if (action === "queue_recording") {
      const game = await requireRecord<Game>("game", body.gameId);
      const mode = z.enum(["jev", "fixture"]).parse(body.mode);
      if (
        mode === "fixture" &&
        (new URL(game.url).pathname !== "/fixture/index.html" ||
          new URL(game.url).origin !== publicOrigin(request))
      )
        throw new HttpError(
          400,
          "Fixture decisions are limited to this application’s controlled game. Use Jev for an adapted public game.",
        );
      if (mode === "jev" && !(await secretFor(workspace, "jev")))
        throw new HttpError(400, "Connect and verify your Jev key first.");
      const recording: Recording = {
        id: id("rec"),
        gameId: game.id,
        title: `${game.title} · ${mode === "fixture" ? "fixture" : "Jev"} run`,
        status: "queued",
        mode,
        createdAt: new Date().toISOString(),
      };
      await put(workspace, "recording", recording);
      await enqueue(workspace, "recording", recording);
      return Response.json({ recording });
    }
    if (action === "create_clip") {
      const recording = await requireRecord<Recording>(
        "recording",
        body.recordingId,
      );
      const v = z
        .object({
          title: str,
          start: z.number().min(0),
          end: z.number().positive(),
          layout: z.enum(["landscape", "portrait", "square"]),
        })
        .parse({ ...body, start: Number(body.start), end: Number(body.end) });
      if (
        recording.status !== "ready" ||
        !recording.duration ||
        v.end > recording.duration ||
        v.end <= v.start ||
        v.end - v.start > 60
      )
        throw new HttpError(
          400,
          "Choose up to 60 seconds within a ready recording.",
        );
      const clip: Clip = {
        ...v,
        id: id("clip"),
        gameId: recording.gameId,
        recordingId: recording.id,
        status: "queued",
        createdAt: new Date().toISOString(),
      };
      await put(workspace, "clip", clip);
      await enqueue(workspace, "clip", clip);
      return Response.json({ clip });
    }
    if (action === "generate_draft") {
      const game = await requireRecord<Game>("game", body.gameId);
      const clip = body.clipId
        ? await requireRecord<Clip>("clip", body.clipId)
        : undefined;
      if (clip && clip.gameId !== game.id)
        throw new HttpError(400, "Choose a clip from this game.");
      const secret = await secretFor(workspace, "anthropic");
      if (!secret)
        throw new HttpError(400, "Connect Anthropic to generate a draft.");
      if (!secret.model)
        throw new HttpError(
          400,
          "Set a valid Anthropic model in Connections before generating a draft.",
        );
      const recording = clip
        ? await get<Recording>(workspace, "recording", clip.recordingId)
        : undefined;
      const context = JSON.stringify({
        observations: recording?.observations || [],
        clip: clip ? { start: clip.start, end: clip.end } : null,
      });
      return Response.json({
        text: await draftContent({
          game,
          clip,
          channel: channel.parse(body.channel),
          secret,
          context,
        }),
      });
    }
    if (action === "create_post" || action === "update_post") {
      const v = postFields.parse(body);
      const game = await requireRecord<Game>("game", v.gameId);
      if (v.clipId) {
        const clip = await requireRecord<Clip>("clip", v.clipId);
        if (clip.gameId !== game.id)
          throw new HttpError(400, "Choose a clip from this game.");
      }
      let post: Post;
      let expectedPost: Post | undefined;
      if (action === "update_post") {
        post = await requireRecord<Post>("post", body.id);
        expectedPost = post;
        if (["uploading", "processing", "published"].includes(post.status))
          throw new HttpError(
            409,
            "This post has entered publication and cannot be edited. Create a new draft.",
          );
        post = {
          ...post,
          ...v,
          scheduledAt: v.scheduledAt || undefined,
          tiktokConsent: v.channel === "tiktok" ? v.tiktokConsent : undefined,
          status: "draft",
          approvedAt: undefined,
          approvedBy: undefined,
          approvedHash: undefined,
          error: undefined,
          providerId: undefined,
        };
      } else
        post = {
          ...v,
          scheduledAt: v.scheduledAt || undefined,
          id: id("post"),
          status: "draft",
          createdAt: new Date().toISOString(),
          campaignId: id("campaign"),
        };
      const tracked = new URL(game.url);
      tracked.searchParams.set("utm_source", post.channel);
      tracked.searchParams.set("utm_medium", "social");
      tracked.searchParams.set("utm_campaign", post.campaignId);
      post.trackingUrl = tracked.href;
      if (action === "update_post") {
        const expected = expectedPost!;
        if (!(await comparePut(workspace, "post", expected, post)))
          throw new HttpError(409, "The post changed. Reload before editing.");
      } else await put(workspace, "post", post);
      return Response.json({ post });
    }
    if (action === "get_tiktok_creator")
      return Response.json(
        await creator(workspace, z.string().max(200).parse(body.accountId)),
      );
    if (
      [
        "submit_review",
        "approve_post",
        "publish_post",
        "check_publication",
        "delete_post",
      ].includes(action)
    ) {
      const post = await requireRecord<Post>("post", body.id);
      if (action === "delete_post") {
        if (!["draft", "review"].includes(post.status))
          throw new HttpError(
            409,
            "Only drafts and items awaiting review can be deleted.",
          );
        const removed = await query(
          "DELETE FROM records WHERE workspace_id=$1 AND kind='post' AND id=$2 AND body=$3::jsonb RETURNING id",
          [workspace, post.id, JSON.stringify(post)],
        );
        if (!removed.length)
          throw new HttpError(409, "The post changed. Reload before deleting.");
        return Response.json({ ok: true });
      }
      if (action === "submit_review") {
        if (!["draft", "failed"].includes(post.status))
          throw new HttpError(409, "Only a draft can be submitted for review.");
        if (
          !(await comparePut(workspace, "post", post, {
            ...post,
            status: "review",
            approvedAt: undefined,
            approvedBy: undefined,
            approvedHash: undefined,
          }))
        )
          throw new HttpError(409, "The post changed. Reload before review.");
        return Response.json({ ok: true });
      }
      if (action === "approve_post") {
        if (post.status !== "review")
          throw new HttpError(
            409,
            "Submit the current draft for review first.",
          );
        if (
          !post.accountId ||
          !(await secretFor(workspace, post.channel, post.accountId))
        )
          throw new HttpError(
            400,
            "Connect and verify this destination account before approving.",
          );
        if (post.clipId) {
          const clip = await requireRecord<Clip>("clip", post.clipId);
          if (clip.status !== "ready")
            throw new HttpError(400, "Wait for the selected clip to finish.");
        } else if (post.channel !== "x")
          throw new HttpError(400, "This channel requires a video clip.");
        if (post.channel === "x" && Array.from(post.text).length > 280)
          throw new HttpError(400, "Keep the X post within 280 characters.");
        if (post.channel === "tiktok") {
          if (!post.tiktokConsent)
            throw new HttpError(
              400,
              "Load TikTok creator settings and confirm consent for this post.",
            );
          const info = await creator(workspace, post.accountId),
            t = post.tiktokConsent;
          if (
            !info.privacyOptions.includes(t.privacy) ||
            (info.commentDisabled && !t.disableComment) ||
            (info.duetDisabled && !t.disableDuet) ||
            (info.stitchDisabled && !t.disableStitch)
          )
            throw new HttpError(
              400,
              "TikTok creator settings changed. Review the options again.",
            );
          if (
            t.privacy === "PUBLIC_TO_EVERYONE" &&
            process.env.TIKTOK_PUBLIC_POSTING_APPROVED !== "true"
          )
            throw new HttpError(
              400,
              "TikTok public posting requires an audited application. Use the approved application configuration.",
            );
          const clip = await requireRecord<Clip>("clip", post.clipId);
          if (clip.end - clip.start > info.maxDuration)
            throw new HttpError(
              400,
              "The clip exceeds this TikTok creator’s duration limit.",
            );
        }
        const next = {
          ...post,
          status: (post.scheduledAt
            ? "scheduled"
            : "approved") as Post["status"],
          approvedAt: new Date().toISOString(),
          approvedBy: user.id,
          approvedHash: approvalHash(post),
        };
        if (!(await comparePut(workspace, "post", post, next)))
          throw new HttpError(
            409,
            "The post changed. Review the current version before approving.",
          );
        return Response.json({ post: next });
      }
      if (action === "publish_post")
        return Response.json({
          post: await dispatch(workspace, post.id, true),
        });
      return Response.json({ post: await reconcile(workspace, post) });
    }
    if (action === "save_connection") {
      const v = z
        .object({
          provider: z.enum([
            "jev",
            "anthropic",
            "x",
            "youtube",
            "instagram",
            "tiktok",
            "reddit",
            "brave",
            "search_console",
          ]),
          label: str,
          token: z.string().min(8).max(10000),
          accountId: z.string().max(200).optional(),
          refreshToken: z.string().max(10000).optional(),
          model: z.string().max(100).optional(),
        })
        .parse(body);
      const secret: ProviderSecret = {
        token: v.token,
        ...(v.accountId ? { accountId: v.accountId } : {}),
        ...(v.refreshToken ? { refreshToken: v.refreshToken } : {}),
        ...(v.model ? { model: v.model } : {}),
      };
      const checked = await testConnection(v.provider, secret);
      if (!checked.connected) throw new HttpError(400, checked.details);
      secret.accountId = checked.accountId || v.accountId;
      const existing = (await list<Connection>(workspace, "connection")).find(
        (c) => c.provider === v.provider && c.accountId === secret.accountId,
      );
      const connection: Connection = {
        id: existing?.id || id("conn"),
        provider: v.provider,
        label: v.label,
        accountId: secret.accountId,
        connected: true,
        checkedAt: new Date().toISOString(),
        details: checked.details,
        model: v.model,
      };
      await saveSecret(workspace, connection.id, secret);
      await put(workspace, "connection", connection);
      return Response.json({ connection });
    }
    if (action === "delete_connection") {
      const connection = await requireRecord<Connection>("connection", body.id);
      await query(
        "DELETE FROM credentials WHERE workspace_id=$1 AND provider=$2",
        [workspace, connection.id],
      );
      await remove(workspace, "connection", connection.id);
      return Response.json({ ok: true });
    }
    if (action === "run_research") {
      const game = await requireRecord<Game>("game", body.gameId);
      if (!(await rateLimit(`research:${game.id}`, 5, 86400)))
        throw new HttpError(
          429,
          "Manual research is limited to five runs per game per day.",
        );
      return Response.json({
        run: await researchJob(
          workspace,
          game,
          `manual:${new Date().toISOString().slice(0, 16)}`,
        ),
      });
    }
    if (action === "start_measurement") {
      const finding = await requireRecord<Finding>("finding", body.findingId);
      const note = z.string().trim().min(3).max(500).parse(body.note);
      const a = await analytics(workspace, finding.gameId, 14);
      const measurement = {
        id: id("measure"),
        gameId: finding.gameId,
        findingId: finding.id,
        note,
        startedAt: new Date().toISOString(),
        baseline: {
          sessions: a.sessions,
          starts: a.starts,
          completions: a.completions,
          errorSessions: a.errorSessions,
        },
      };
      await put(workspace, "measurement", measurement);
      return Response.json({ measurement });
    }
    if (action === "update_finding") {
      const finding = await requireRecord<Finding>("finding", body.id);
      const status = z
        .enum(["open", "in_progress", "resolved"])
        .parse(body.status);
      await put(workspace, "finding", {
        ...finding,
        status,
        resolvedAt:
          status === "resolved" ? new Date().toISOString() : undefined,
      });
      return Response.json({ ok: true });
    }
    throw new HttpError(400, "Unknown action.");
  } catch (e) {
    if (e instanceof z.ZodError || e instanceof SyntaxError)
      return Response.json(
        { error: "Some fields are invalid. Check the form and try again." },
        { status: 400 },
      );
    return apiError(e);
  }
}
