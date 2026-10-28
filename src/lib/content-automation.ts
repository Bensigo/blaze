import { get, query } from "./db";
import { hash } from "./security";
import { secretFor } from "./credentials";
import { loadAgentHistory } from "./agent-history";
import { draftContent } from "./integrations/writing";
import { actualJev, hasRecordingAsset } from "./game-automation";
import type { Channel, Clip, Connection, Game, Post, Recording } from "./types";
import type { MediaRecord } from "./media";

const jobId = (workspace: string, clipId: string) => `content_${hash(`${workspace}:${clipId}`).slice(0, 32)}`;
const postId = (workspace: string, clipId: string) => `post_${hash(`${workspace}:${clipId}:draft`).slice(0, 32)}`;

// A stable job key prevents duplicates, including after deletion of the draft.
export async function queueClipDraft(workspace: string, clip: Clip) {
  if (clip.status !== "ready") return false;
  const recording = await get<Recording>(workspace, "recording", clip.recordingId);
  if (!recording || recording.gameId !== clip.gameId || !actualJev(recording) || !await hasRecordingAsset(workspace, recording)) return false;
  const mediaId = /^\/api\/media\/(media_[a-z0-9]+)$/.exec(clip.videoUrl || "")?.[1];
  const media = mediaId ? await get<MediaRecord>(workspace, "media", mediaId) : undefined;
  if (!media || media.kind !== "clip" || media.clipId !== clip.id || media.recordingId !== recording.id || media.captureId || (media.expiresAt && Date.parse(media.expiresAt) <= Date.now()) || !["video/mp4", "video/webm"].includes(media.contentType)) return false;
  const connection = (await query<{ body: Connection }>(`SELECT body FROM records WHERE workspace_id=$1 AND kind='connection' AND body->>'provider'='anthropic' AND body->>'connected'='true' ORDER BY updated_at DESC LIMIT 1`, [workspace]))[0]?.body;
  const secret = connection?.checkedAt && connection.model ? await secretFor(workspace, "anthropic").catch(() => undefined) : undefined;
  if (!secret?.token || !secret.model || secret.model !== connection?.model) return false;
  return (await query(`INSERT INTO jobs(id,workspace_id,kind,state,body) VALUES($1,$2,'content_draft','queued',$3::jsonb) ON CONFLICT DO NOTHING RETURNING id`, [jobId(workspace, clip.id), workspace, JSON.stringify({ gameId: clip.gameId, clipId: clip.id })])).length > 0;
}

export async function drainContentAutomation() {
  // Never automatically retry an ambiguous model request after a process crash.
  await query(`WITH expired AS (UPDATE jobs SET state='failed',body=body || '{"error":"Draft generation was interrupted; create a draft manually."}'::jsonb,updated_at=now() WHERE kind='content_draft' AND state='claimed' AND lease_until<now() RETURNING workspace_id,body)
    INSERT INTO records(workspace_id,kind,id,body) SELECT workspace_id,'post','post_' || substr(encode(sha256(convert_to(workspace_id || ':' || (body->>'clipId') || ':draft','UTF8')),'hex'),1,32),
    jsonb_build_object('id','post_' || substr(encode(sha256(convert_to(workspace_id || ':' || (body->>'clipId') || ':draft','UTF8')),'hex'),1,32),'gameId',body->>'gameId','clipId',body->>'clipId','channel','youtube','text','','accountId','','deliveryMethod','manual','status','failed','createdAt',now(),'campaignId','','error','Automatic draft was interrupted. Create a draft manually.') FROM expired ON CONFLICT DO NOTHING`);
  const row = (await query<{ id: string; workspace_id: string; body: { gameId: string; clipId: string }; lease_until: Date }>(`UPDATE jobs SET state='claimed',lease_until=now()+interval '2 minutes',updated_at=now() WHERE id=(SELECT id FROM jobs WHERE kind='content_draft' AND state='queued' AND available_at<=now() ORDER BY available_at FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING id,workspace_id,body,lease_until`))[0];
  if (!row) return;
  const { workspace_id: workspace, body } = row;
  const clip = await get<Clip>(workspace, "clip", body.clipId);
  const game = await get<Game>(workspace, "game", body.gameId);
  const channel: Channel = clip?.layout === "portrait" ? "tiktok" : clip?.layout === "square" ? "instagram" : "youtube";
  const at = new Date(); at.setUTCDate(at.getUTCDate() + 1); at.setUTCHours(18, 0, 0, 0);
  const base: Post & { recommendation: { confidence: "low"; reason: string; time: string } } = {
    id: postId(workspace, body.clipId), gameId: body.gameId, clipId: body.clipId, channel, text: "", accountId: "", deliveryMethod: "manual", status: "draft", scheduledAt: at.toISOString(), timeZone: "UTC", createdAt: new Date().toISOString(), campaignId: `campaign_${hash(`${workspace}:${body.clipId}`).slice(0,24)}`,
    recommendation: { confidence: "low", reason: "Cold start: channel is a format-based starting point, not an audience ranking.", time: "18:00 UTC tomorrow is an arbitrary editable starting time, not an audience prediction." },
  };
  try {
    if (!clip || !game || clip.gameId !== game.id || clip.status !== "ready") throw new Error("Clip unavailable");
    const recording = await get<Recording>(workspace, "recording", clip.recordingId);
    const mediaId = /^\/api\/media\/(media_[a-z0-9]+)$/.exec(clip.videoUrl || "")?.[1];
    const media = mediaId ? await get<MediaRecord>(workspace, "media", mediaId) : undefined;
    if (!recording || recording.gameId !== game.id || !actualJev(recording) || !await hasRecordingAsset(workspace, recording) || !media || media.kind !== "clip" || media.clipId !== clip.id || media.recordingId !== recording.id || media.captureId || (media.expiresAt && Date.parse(media.expiresAt) <= Date.now()) || !["video/mp4", "video/webm"].includes(media.contentType)) throw new Error("Evidence unavailable");
    const connection = (await query<{ body: Connection }>(`SELECT body FROM records WHERE workspace_id=$1 AND kind='connection' AND body->>'provider'='anthropic' AND body->>'connected'='true' ORDER BY updated_at DESC LIMIT 1`, [workspace]))[0]?.body;
    const secret = connection?.checkedAt && connection.model ? await secretFor(workspace, "anthropic") : undefined;
    if (!secret?.token || !secret.model || secret.model !== connection?.model) throw new Error("Connection unavailable");
    const history = await loadAgentHistory(workspace, game.id);
    // Only bounded observations, no private asset URLs, actions or identifiers.
    const observations = (recording.observations || []).filter(o => o.type === "observation" && o.at >= clip.start && o.at <= clip.end).slice(0, 8).map(o => ({ at: o.at, text: o.text.replace(/https?:\/\/\S+|\b(?:session|player|recording|capture|media)_[\w-]+\b/gi, "[omitted]").slice(0, 500) }));
    base.text = (await draftContent({ game, clip, channel, secret, history, context: JSON.stringify({ observations }) })).slice(0, 4000);
    const tracked = new URL(game.url); tracked.searchParams.set("utm_source", channel); tracked.searchParams.set("utm_medium", "social"); tracked.searchParams.set("utm_campaign", base.campaignId); base.trackingUrl = tracked.href;
    await finish(row, base, "complete");
  } catch {
    base.status = "failed";
    base.error = "Automatic draft failed. Check the verified Anthropic connection and model, then create a draft manually.";
    await finish(row, base, "failed");
  }
}

async function finish(row: { id: string; workspace_id: string; lease_until: Date }, post: Post, state: "complete" | "failed") {
  await query(`WITH saved AS (INSERT INTO records(workspace_id,kind,id,body) SELECT $1,'post',$2,$3::jsonb FROM jobs WHERE id=$4 AND state='claimed' AND lease_until=$5::timestamptz ON CONFLICT DO NOTHING RETURNING id) UPDATE jobs SET state=$6,lease_until=NULL,updated_at=now() WHERE id=$4 AND state='claimed' AND lease_until=$5::timestamptz AND EXISTS(SELECT 1 FROM saved)`, [row.workspace_id, post.id, JSON.stringify(post), row.id, row.lease_until, state]);
}
