import { comparePut, get, query } from "./db";
import { HttpError } from "./http-error";
import { approvalValid } from "./publishing";
import { mediaRecord } from "./media";
import type { Clip, Game, Post, Channel } from "./types";

async function approved(workspace: string, postId: string) {
  const post = await get<Post>(workspace, "post", postId);
  if (!post) throw new HttpError(404, "Post not found.");
  if (post.deliveryMethod !== "manual") throw new HttpError(400, "Choose manual delivery for this post.");
  if (!approvalValid(post) || !["approved", "scheduled"].includes(post.status)) throw new HttpError(409, "Review and approve the current content, destination and time first.");
  if (!post.accountId.trim()) throw new HttpError(400, "Enter the manual destination handle.");
  if (!post.scheduledAt || !Number.isFinite(Date.parse(post.scheduledAt)) || !post.timeZone) throw new HttpError(400, "Set a planned time and time zone before approval and export.");
  try { if (/^[+-]/.test(post.timeZone)) throw new Error(); new Intl.DateTimeFormat("en", { timeZone: post.timeZone }); } catch { throw new HttpError(400, "Use a valid IANA time zone."); }
  const clip = post.clipId ? await get<Clip>(workspace, "clip", post.clipId) : undefined;
  if (!clip || clip.gameId !== post.gameId || clip.status !== "ready" || !clip.videoUrl) throw new HttpError(400, "A ready video clip from this game is required.");
  const mid = /^\/api\/media\/(media_[a-z0-9]+)$/.exec(clip.videoUrl)?.[1];
  const asset = mid ? await mediaRecord(workspace, mid) : undefined;
  if (!asset || asset.kind !== "clip" || asset.clipId !== clip.id || asset.recordingId !== clip.recordingId || asset.captureId || !["video/mp4", "video/webm"].includes(asset.contentType)) throw new HttpError(404, "The private clip file is unavailable.");
  if (asset.expiresAt && Date.parse(asset.expiresAt) <= Date.now()) throw new HttpError(410, "The clip has expired.");
  return { post, clip, asset };
}

async function recommendation(workspace: string, gameId: string, clip: Clip) {
  const sources = await query<{ source: Channel; sessions: number }>(`SELECT lower(source) AS source,count(DISTINCT session_id)::int AS sessions FROM events WHERE workspace_id=$1 AND game_id=$2 AND kind='human' AND name='visit' AND occurred_at>=now()-interval '90 days' AND occurred_at<=now() AND lower(source) IN ('x','youtube','instagram','tiktok') GROUP BY lower(source) ORDER BY sessions DESC,source LIMIT 4`, [workspace, gameId]);
  const sourceTotal = sources.reduce((sum, row) => sum + Number(row.sessions), 0);
  const signal = sourceTotal >= 20 && sources[0] && Number(sources[0].sessions) > Number(sources[1]?.sessions || 0) ? sources[0] : undefined;
  const platform: Channel = signal?.source || (clip.layout === "landscape" ? "youtube" : clip.layout === "portrait" ? "tiktok" : "instagram");
  return {
    platform,
    confidence: "low" as const,
    platformReason: signal ? `In the last 90 days, ${signal.sessions} human visit sessions reported ${signal.source} as their source (${sourceTotal} across the listed social sources). This is observational and does not prove post impact.` : `Cold start: ${clip.layout} video is a format-based starting point; there is not enough attributed social traffic to rank channels.`,
    time: "Try 18:00 in the selected time zone as an initial experiment; this is an arbitrary starting time, not an audience-based prediction.",
    source: signal ? "Human visit telemetry, last 90 days; UTM/SDK source" : "Clip format; no reliable channel history",
  };
}

export async function prepareManualExport(workspace: string, postId: string) {
  const { post, clip } = await approved(workspace, postId);
  const game = await get<Game>(workspace, "game", post.gameId);
  if (!game) throw new HttpError(404, "Game not found.");
  const suggested = await recommendation(workspace, post.gameId, clip);
  const updated: Post = { ...post, manualExportedAt: post.manualExportedAt || new Date().toISOString() };
  if (!await comparePut(workspace, "post", post, updated)) throw new HttpError(409, "The post changed. Review it again.");
  return { caption: post.text, channel: post.channel, destination: post.accountId, destinationVerified: false, scheduledAt: post.scheduledAt || null, timeZone: post.timeZone || null, downloadUrl: `/api/posts/${encodeURIComponent(post.id)}/manual-export/download`, recommendation: suggested, exportedAt: updated.manualExportedAt };
}
export async function manualExportAsset(workspace: string, postId: string) {
  const { post, asset } = await approved(workspace, postId);
  if (!post.manualExportedAt) throw new HttpError(409, "Prepare the approved export first.");
  return asset;
}
export async function confirmManualPublication(workspace: string, postId: string, userId: string, publishedAt: string, url: string) {
  const { post } = await approved(workspace, postId);
  if (!post.manualExportedAt) throw new HttpError(409, "Prepare the approved export first.");
  const time = Date.parse(publishedAt);
  if (!Number.isFinite(time) || time > Date.now() + 60000) throw new HttpError(400, "Enter a valid publication time that is not in the future.");
  let parsed: URL;
  try { parsed = new URL(url); } catch { throw new HttpError(400, "Enter a valid HTTPS publication URL."); }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || url.length > 2000) throw new HttpError(400, "Enter a valid HTTPS publication URL.");
  const next: Post = { ...post, manualPublishedAt: new Date(time).toISOString(), manualConfirmedAt: new Date().toISOString(), manualPublishedBy: userId, manualPublicationUrl: parsed.href };
  if (!await comparePut(workspace, "post", post, next)) throw new HttpError(409, "The post changed. Review it again.");
  return next;
}
