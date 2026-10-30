import { z } from "zod";
import { comparePut, get, list, put, query, transaction } from "./db";
import { hash } from "./security";
import { HttpError } from "./http-error";
import { readAISettings } from "./ai-settings";
import { secretForConnection } from "./credentials";
import { readProfile } from "./game-profile";
import { mediaStorageConfigured, mediaRecord, saveAsset } from "./media";
import { managedFileBytes, managedOutputFiles, readManagedSession, startManagedSession } from "./managed-gameplay-agent";
import type { Connection, Game } from "./types";
import type { ContentIdea, IdeaSchedule, StudioSnapshot, VideoProduction } from "./content-studio-contract";
import { Input, BufferSource, MP4 } from "mediabunny";
import { PRODUCTION_RUNTIME_MS, requestProductionStop, unresolvedProduction, watchdogReady } from "./content-production-watchdog";

export const videoSettingsSchema = z.object({
  aspectRatio: z.enum(["16:9", "9:16", "1:1"]), durationSeconds: z.number().int().min(10).max(60),
  captions: z.enum(["minimal", "full", "none"]), music: z.enum(["quiet_generated", "none"]),
  gameAudio: z.boolean(), motionGraphics: z.boolean(),
}).strict();
export const scheduleSchema = z.object({
  countPerGame: z.union([z.literal(2), z.literal(3)]), localTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable(),
  maxOutputTokensPerGame: z.number().int().min(500).max(2500),
}).strict();
const defaultSchedule: IdeaSchedule = { id: "default", countPerGame: 3, localTime: null, enabled: false, timeZone: "Asia/Dubai", maxOutputTokensPerGame: 1800 };
type ProviderConfig = { id: "default"; connectionId: string; agentId: string; agentVersion: number; environmentId: string; revision: string; pilotVerified: boolean; networkPolicyVerified: boolean; organizationVerified: boolean; watchdogVerified: boolean;
  reviewedGames?: Record<string, { sourceRevision: string; gameAudioVerified: boolean }> };
export const dubaiDate = (date = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dubai", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
const getGame = async (workspace: string, gameId: string) => {
  const game = await get<Game>(workspace, "game", gameId);
  if (!game) throw new HttpError(404, "Game not found.");
  return game;
};
export async function gameSources(workspace: string, gameId: string) {
  const game = await getGame(workspace, gameId);
  const profile = await readProfile(workspace, gameId);
  // Only source-backed game capabilities. No private telemetry, player IDs, credentials or owner overrides.
  const facts = profile.facts.filter(f => /^(manifest_(name|description|genre|controls|rules|about:|faq:)|page_(title|description))/.test(f.key))
    .slice(0, 30).map(f => ({ key: f.key, value: f.value.slice(0, 1600), evidence: f.evidence }));
  if (!facts.length) throw new HttpError(409, "Investigate this game's profile before preparing video ideas. No source-backed game facts are available.");
  const url = new URL(game.url); url.search = ""; url.hash = "";
  if (url.protocol !== "https:" || url.username || url.password) throw new HttpError(409, "A public HTTPS game URL is required.");
  const networkPolicy = game.networkPolicy || { resourceOrigins: [], webSocketOrigins: [] };
  return { gameId, title: game.title, url: url.href, facts, networkPolicy, revision: hash(JSON.stringify({ url: url.href, manifest: game.manifestSource, facts, networkPolicy })) };
}
export async function studioReadiness(workspace: string) {
  const [config, selected, connections] = await Promise.all([
    get<ProviderConfig>(workspace, "content_provider", "default"), readAISettings(workspace).catch(() => null), list<Connection>(workspace, "connection"),
  ]);
  const connection = connections.find(c => c.id === (config?.connectionId || selected?.connectionId) && c.provider === "anthropic" && c.connected);
  const reasons: string[] = [];
  if (!connection) reasons.push("Select the existing direct Anthropic key in Account settings. OpenRouter/Jev credits are separate.");
  if (!config?.agentId || !config.environmentId) reasons.push("Link the reviewed Claude producer agent and restricted cloud environment to Blaze.");
  if (!config?.organizationVerified) reasons.push("Verify that the saved Anthropic key belongs to the credit-bearing organization.");
  if (!config?.networkPolicyVerified) reasons.push("Review the cloud environment's game and asset host allowlist.");
  if (!config?.pilotVerified) reasons.push("Approve one bounded cloud gameplay pilot to verify controls, WebGL, recording and any required audio.");
  if (!config?.watchdogVerified) reasons.push("Verify a monitored 30-minute cloud-session stop before enabling production.");
  if (!config || !await watchdogReady(workspace, config.revision)) reasons.push("A fresh, healthy cloud-runtime watchdog heartbeat is required.");
  if (await unresolvedProduction(workspace)) reasons.push("An earlier cloud start, stop or runtime deadline needs reconciliation before another attempt.");
  if (process.env.BLAZE_CLOUD_PRODUCTION_ENABLED !== "true") reasons.push("Cloud production is disabled pending setup and pilot approval.");
  if (!mediaStorageConfigured()) reasons.push("Configure Blaze private video storage.");
  return { ready: reasons.length === 0, reasons, provider: "anthropic_managed_agents" as const, connectionLabel: connection?.label };
}
export async function studioSnapshot(workspace: string, gameId?: string): Promise<StudioSnapshot> {
  if (gameId) await getGame(workspace, gameId);
  const [ideas, productions, schedule, readiness] = await Promise.all([
    list<ContentIdea>(workspace, "content_idea"), list<VideoProduction>(workspace, "video_production"),
    get<IdeaSchedule>(workspace, "idea_schedule", "default"), studioReadiness(workspace),
  ]);
  const activeGames = new Set((await list<Game>(workspace, "game")).map(game => game.id));
  return { ideas: ideas.filter(v => activeGames.has(v.gameId) && (!gameId || v.gameId === gameId)), productions: productions.filter(v => activeGames.has(v.gameId) && (!gameId || v.gameId === gameId)), schedule: schedule || defaultSchedule, readiness };
}
export async function saveIdeaSchedule(workspace: string, input: z.infer<typeof scheduleSchema>) {
  // Saving preferences never activates a metered recurring task or preserves an old spend approval.
  return put(workspace, "idea_schedule", { ...defaultSchedule, ...scheduleSchema.parse(input), enabled: false });
}

// Useful no-spend outlines while the daily AI agent is unconfigured. Clearly labelled in the UI.
// Exact same source/angle never repeats, including on another date.
export async function prepareSourceIdeas(workspace: string, gameId: string) {
  const source = await gameSources(workspace, gameId);
  const schedule = await get<IdeaSchedule>(workspace, "idea_schedule", "default") || defaultSchedule;
  const candidates = [
    { angle: "first_play", title: `First play: ${source.title}`, hook: `What happens when you play ${source.title}?`, treatment: "Show the real entry into play, one readable action and its observed outcome.", shots: ["Open the actual game", "Show a supported action", "Hold on its real result"] },
    { angle: "how_to_play", title: `How to play ${source.title}`, hook: "See the controls in action.", treatment: "Demonstrate only controls documented by the game. Tie each caption to the action on screen.", shots: ["Show documented controls", "Perform the corresponding action", "Show what changed"] },
    { angle: "one_sequence", title: `A play sequence in ${source.title}`, hook: "One action and its actual result.", treatment: "Follow one genuine play sequence. Keep its order and do not imply a win unless captured.", shots: ["Begin a real play sequence", "Capture a meaningful decision", "Show the observed outcome"] },
  ].filter(c => c.angle !== "how_to_play" || source.facts.some(f => f.key === "manifest_controls"));
  const ideas: ContentIdea[] = [];
  for (const candidate of candidates.slice(0, schedule.countPerGame)) {
    const fingerprint = hash(`${source.revision}:${candidate.angle}`);
    const idea: ContentIdea = { id: `idea_${hash(`${workspace}:${gameId}:${fingerprint}`).slice(0, 32)}`, gameId,
      title: candidate.title, hook: candidate.hook, treatment: candidate.treatment, shots: candidate.shots,
      factKeys: source.facts.map(f => f.key), sourceRevision: source.revision, createdAt: new Date().toISOString(), origin: "source_outline", fingerprint };
    await query(`INSERT INTO records(workspace_id,kind,id,body) VALUES($1,'content_idea',$2,$3::jsonb) ON CONFLICT DO NOTHING`, [workspace, idea.id, JSON.stringify(idea)]);
    ideas.push(idea);
  }
  return ideas;
}
export async function approveVideo(workspace: string, actor: string, input: { ideaId: string; settings: unknown; maxListCostCents: number; requestId: string }) {
  const settings = videoSettingsSchema.parse(input.settings);
  z.number().int().min(1).max(5000).parse(input.maxListCostCents);
  z.string().uuid().parse(input.requestId);
  const idea = await get<ContentIdea>(workspace, "content_idea", input.ideaId);
  if (!idea) throw new HttpError(404, "Idea not found.");
  const source = await gameSources(workspace, idea.gameId);
  if (source.revision !== idea.sourceRevision) throw new HttpError(409, "The game evidence changed. Refresh the ideas and review them again.");
  const readiness = await studioReadiness(workspace);
  if (!readiness.ready) throw new HttpError(409, readiness.reasons.join(" "));
  const config = (await get<ProviderConfig>(workspace, "content_provider", "default"))!;
  if (config.reviewedGames?.[idea.gameId]?.sourceRevision !== source.revision || (settings.gameAudio && !config.reviewedGames[idea.gameId].gameAudioVerified))
    throw new HttpError(409, "This game's current cloud play, network policy and requested audio need a verified pilot before generation.");
  const credentialRevision = await credentialFingerprint(workspace, config.connectionId);
  const now = new Date().toISOString();
  const production: VideoProduction = { id: `production_${hash(`${workspace}:${input.requestId}`).slice(0, 32)}`, gameId: idea.gameId, ideaId: idea.id, idea,
    settings, state: "approved", approvedBy: actor, approvedAt: now, createdAt: now, updatedAt: now, expiresAt: new Date(Date.now() + 15 * 60000).toISOString(),
    sourceRevision: source.revision, providerRevision: config.revision, credentialRevision, maxListCostCents: input.maxListCostCents,
    approvalHash: hash(JSON.stringify({ idea, settings, maxListCostCents: input.maxListCostCents, sourceRevision: source.revision, providerRevision: config.revision, credentialRevision })) };
  return transaction(async sql => {
    // Serialize approvals per idea, including different tabs with different request IDs.
    await sql(`SELECT id FROM records WHERE workspace_id=$1 AND kind='content_idea' AND id=$2 FOR UPDATE`, [workspace, idea.id]);
    const old = (await sql<{ body: VideoProduction }>(`SELECT body FROM records WHERE workspace_id=$1 AND kind='video_production' AND id=$2`, [workspace, production.id]))[0]?.body;
    if (old) {
      if (old.approvalHash !== production.approvalHash) throw new HttpError(409, "This request already approved different settings. Review the existing run.");
      return old;
    }
    const active = (await sql<{ body: VideoProduction }>(`SELECT body FROM records WHERE workspace_id=$1 AND kind='video_production' AND body->>'ideaId'=$2 AND body->>'state' IN ('approved','starting','running','importing','cancel_requested','needs_reconciliation')`, [workspace, idea.id]))[0]?.body;
    if (active) {
      if (active.approvalHash !== production.approvalHash) throw new HttpError(409, "This idea already has an active run with different settings. Review that run first.");
      return active;
    }
    await sql(`INSERT INTO records(workspace_id,kind,id,body) VALUES($1,'video_production',$2,$3::jsonb)`, [workspace, production.id, JSON.stringify(production)]);
    return production;
  });
}
async function productionRecord(workspace: string, productionId: string) {
  const production = await get<VideoProduction>(workspace, "video_production", productionId);
  if (!production) throw new HttpError(404, "Video not found.");
  return production;
}
async function providerSecret(workspace: string, revision: string) {
  const config = await get<ProviderConfig>(workspace, "content_provider", "default");
  if (!config || config.revision !== revision) throw new HttpError(409, "The producer setup changed. Review and approve a new run.");
  const connection = await get<Connection>(workspace, "connection", config.connectionId);
  if (!connection?.connected || connection.provider !== "anthropic") throw new HttpError(409, "The direct Anthropic connection is unavailable.");
  const secret = await secretForConnection(workspace, config.connectionId);
  if (!secret?.token) throw new HttpError(409, "The saved Anthropic key is unavailable.");
  return { config, secret };
}
async function credentialFingerprint(workspace: string, connectionId: string) {
  const encrypted = (await query<{ encrypted: string }>("SELECT encrypted FROM credentials WHERE workspace_id=$1 AND provider=$2", [workspace, connectionId]))[0]?.encrypted;
  if (!encrypted) throw new HttpError(409, "The saved Anthropic key is unavailable.");
  return hash(encrypted);
}
export async function startApprovedVideo(workspace: string, productionId: string) {
  const production = await productionRecord(workspace, productionId);
  if (production.state !== "approved") return production;
  const source = await gameSources(workspace, production.gameId);
  if (Date.parse(production.expiresAt) <= Date.now() || source.revision !== production.sourceRevision) {
    const failed = { ...production, state: "failed" as const, error: "Approval expired or game evidence changed. Review and approve a new run.", updatedAt: new Date().toISOString() };
    await comparePut(workspace, "video_production", production, failed); return failed;
  }
  if (!(await studioReadiness(workspace)).ready) throw new HttpError(409, "Cloud production is paused. No request was sent.");
  const { config, secret } = await providerSecret(workspace, production.providerRevision);
  if (await credentialFingerprint(workspace, config.connectionId) !== production.credentialRevision) throw new HttpError(409, "The saved key changed. Review and approve a new run.");
  const dispatchAt = Date.now();
  const starting: VideoProduction = { ...production, state: "starting", updatedAt: new Date(dispatchAt).toISOString(), startedAt: new Date(dispatchAt).toISOString(), watchdogDeadlineAt: new Date(dispatchAt + PRODUCTION_RUNTIME_MS).toISOString(), usage: { status: "unavailable" } };
  const reserved = await transaction(async sql => {
    // Serialize starts across all games, independently of the last watchdog heartbeat.
    const provider = await sql(`SELECT id FROM records WHERE workspace_id=$1 AND kind='content_provider' AND id='default' FOR UPDATE`, [workspace]);
    if (!provider.length) return false;
    if (await unresolvedProduction(workspace, production.id, dispatchAt, sql)) throw new HttpError(409, "An earlier cloud start, stop or runtime deadline needs reconciliation before another attempt.");
    const game = await sql(`SELECT id FROM records WHERE workspace_id=$1 AND kind='game' AND id=$2 FOR UPDATE`, [workspace, production.gameId]);
    if (!game.length) return false;
    return (await sql(`UPDATE records SET body=$4::jsonb,updated_at=now() WHERE workspace_id=$1 AND kind='video_production' AND id=$2 AND body=$3::jsonb RETURNING id`, [workspace, productionId, JSON.stringify(production), JSON.stringify(starting)])).length > 0;
  });
  if (!reserved) return productionRecord(workspace, productionId);
  try {
    const session = await startManagedSession(secret, { agentId: config.agentId, agentVersion: config.agentVersion, environmentId: config.environmentId,
      budgetCents: production.maxListCostCents, prompt: JSON.stringify({ productionId, source, idea: production.idea, settings: production.settings,
        requiredOutputs: ["video.mp4", "evidence.json", "raw capture"], instructions: "Actively play the real game in the cloud, capture footage and edit this approved video. Never publish." }) });
    // If cancellation raced the request, retain its marker and attach the session for operator reconciliation.
    await query(`UPDATE records SET body=body || $4::jsonb || jsonb_build_object('state',CASE WHEN body->>'state'='cancel_requested' THEN 'cancel_requested' ELSE 'running' END),updated_at=now() WHERE workspace_id=$1 AND kind='video_production' AND id=$2 AND body->>'approvalHash'=$3`,
      [workspace, productionId, production.approvalHash, JSON.stringify({ sessionId: session.id, updatedAt: new Date().toISOString() })]);
    if ((await productionRecord(workspace, productionId)).state === "cancel_requested") await requestProductionStop(workspace, productionId, "owner_cancel");
  } catch {
    const current = await productionRecord(workspace, productionId);
    await comparePut(workspace, "video_production", current, { ...current, state: "needs_reconciliation", error: "The start result is uncertain. Check the Claude console; this approval will never be retried automatically.", updatedAt: new Date().toISOString() });
  }
  return productionRecord(workspace, productionId);
}
export async function cancelVideo(workspace: string, productionId: string) {
  await productionRecord(workspace, productionId); // Preserve the authenticated route's 404 semantics.
  return requestProductionStop(workspace, productionId, "owner_cancel");
}
export async function planVideo(workspace: string, productionId: string, date: string | null) {
  if (date !== null && (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(`${date}T00:00:00Z`)) || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date)) throw new HttpError(400, "Choose a valid calendar date.");
  const production = await productionRecord(workspace, productionId);
  if (production.state !== "ready" || !production.videoUrl) throw new HttpError(409, "Finish the video before adding a planning date.");
  const mediaId = /^\/api\/media\/(media_[a-z0-9]+)$/.exec(production.videoUrl)?.[1];
  const media = mediaId ? await mediaRecord(workspace, mediaId) : undefined;
  if (!media || media.recordingId !== production.id || media.contentType !== "video/mp4") throw new HttpError(409, "Video media is unavailable.");
  const next: VideoProduction = { ...production, plannedDate: date || undefined, planningTimeZone: "Asia/Dubai", updatedAt: new Date().toISOString() };
  if (!await comparePut(workspace, "video_production", production, next)) throw new HttpError(409, "This video changed. Refresh and try again.");
  return next;
}

const evidenceSchema = z.object({
  gameUrl: z.string().url(), durationSeconds: z.number().positive(),
  playedActions: z.array(z.object({ at: z.number().nonnegative(), action: z.string().min(1).max(300) })).min(1).max(500),
  rawCaptureFilename: z.string().regex(/^raw[-_A-Za-z0-9]*\.(webm|mp4)$/), audioCaptured: z.boolean(),
  limitations: z.array(z.string().max(500)).max(20),
});
export async function inspectProducedVideo(bytes: Uint8Array, production: Pick<VideoProduction, "settings">) {
  const input = new Input({ source: new BufferSource(bytes), formats: [MP4] });
  try {
    const tracks = await input.getVideoTracks(); const audio = await input.getAudioTracks();
    if (tracks.length !== 1) throw new Error("Expected one video track");
    const track = tracks[0];
    const [width, height, duration, rotation, codec] = await Promise.all([track.getDisplayWidth(), track.getDisplayHeight(), input.computeDuration(), track.getRotation(), track.getCodec()]);
    const ratio = production.settings.aspectRatio === "9:16" ? 9 / 16 : production.settings.aspectRatio === "16:9" ? 16 / 9 : 1;
    if (codec !== "avc" || !Number.isFinite(duration) || Math.abs(duration - production.settings.durationSeconds) > 1 || width < 360 || height < 360 || width > 1920 || height > 1920 || Math.abs(width / height - ratio) > 0.015 || rotation !== 0 || audio.length > 1 ||
      (production.settings.gameAudio && !audio.length) || (production.settings.music === "quiet_generated" && !audio.length)) throw new Error("Video does not match approved settings");
    if (audio.length && await audio[0].getCodec() !== "aac") throw new Error("Video audio must be AAC");
    return { width, height, duration, audioTracks: audio.length };
  } finally { input.dispose(); }
}
// GET-only provider reconciliation: never sends a new prompt, resumes a session, or retries paid work.
export async function refreshVideo(workspace: string, productionId: string) {
  let production = await productionRecord(workspace, productionId);
  if (production.state === "ready" || production.state === "cancelled" || production.state === "failed") return production;
  if (production.state === "importing") {
    if (Date.now() - Date.parse(production.updatedAt) > 120000) {
      const evidence = await get(workspace, "production_evidence", production.id);
      const media = (await list<import("./media").MediaRecord>(workspace, "media")).find(m => m.recordingId === production.id && m.kind === "clip" && m.contentType === "video/mp4" && !m.deletedAt);
      const next: VideoProduction = evidence && media ? { ...production, state: "ready", videoUrl: `/api/media/${media.id}`, error: undefined, updatedAt: new Date().toISOString() }
        : { ...production, state: "needs_reconciliation", error: "Artifact import was interrupted. Reconcile the saved cloud output; do not generate again.", updatedAt: new Date().toISOString() };
      await comparePut(workspace, "video_production", production, next); return next;
    }
    return production;
  }
  if (!production.sessionId) {
    if (production.state === "starting" && Date.now() - Date.parse(production.updatedAt) > 60000) {
      await comparePut(workspace, "video_production", production, { ...production, state: "needs_reconciliation", error: "Start was interrupted before the session ID was saved. Reconcile in Claude; never repeat this approval.", updatedAt: new Date().toISOString() });
    }
    return productionRecord(workspace, productionId);
  }
  const sessionId = production.sessionId;
  const { secret } = await providerSecret(workspace, production.providerRevision);
  const session = await readManagedSession(secret, sessionId);
  if (session.usage) {
    const usage: VideoProduction["usage"] = { inputTokens: session.usage.input_tokens, outputTokens: session.usage.output_tokens, listCostCents: session.usage.list_cost?.amount, status: "reported_unsettled" };
    const withUsage = { ...production, usage };
    if (!await comparePut(workspace, "video_production", production, withUsage)) return productionRecord(workspace, productionId);
    production = withUsage;
  }
  if (production.state === "cancel_requested") {
    if (session.status === "idle" || session.status === "terminated") {
      const stopped: VideoProduction = { ...production, state: "cancelled", stoppedAt: new Date().toISOString(), error: undefined, updatedAt: new Date().toISOString(),
        ...(production.stopRequest ? { stopRequest: { ...production.stopRequest, state: "confirmed" } } : {}) };
      await comparePut(workspace, "video_production", production, stopped); return stopped;
    }
    return production;
  }
  if (session.status === "running" || session.status === "rescheduling") return production;
  if (session.status !== "idle") {
    const next = { ...production, state: "failed" as const, error: "Cloud session ended without an accepted video. A retry requires fresh approval.", updatedAt: new Date().toISOString() };
    await comparePut(workspace, "video_production", production, next); return next;
  }
  const files = await managedOutputFiles(secret, sessionId);
  const video = files.find(f => f.filename === "video.mp4");
  const evidence = files.find(f => f.filename === "evidence.json");
  // Outputs can arrive after idle. Missing files are pending, not completed or automatically resumed.
  if (!video || !evidence) return production;
  if (video.size_bytes > 150 * 1024 * 1024 || evidence.size_bytes > 128 * 1024) throw new HttpError(409, "Cloud output exceeds the media limits.");
  const source = await gameSources(workspace, production.gameId);
  const report = evidenceSchema.parse(JSON.parse((await managedFileBytes(secret, evidence.id, 128 * 1024)).toString("utf8")));
  const raw = files.find(f => f.filename === report.rawCaptureFilename);
  if (report.gameUrl !== source.url || !raw || raw.size_bytes < 1000 || (production.settings.gameAudio && !report.audioCaptured) || Math.abs(report.durationSeconds - production.settings.durationSeconds) > 1)
    throw new HttpError(409, "Gameplay evidence or requested audio is missing. The video needs review.");
  const bytes = await managedFileBytes(secret, video.id, 150 * 1024 * 1024);
  const inspection = await inspectProducedVideo(bytes, production);
  // Serialize artifact import independently of paid session creation. A crashed importer is reconcilable, never a paid retry.
  const importing: VideoProduction = { ...production, state: "importing", updatedAt: new Date().toISOString(), error: "Validating and importing the cloud output." };
  if (!await comparePut(workspace, "video_production", production, importing)) return productionRecord(workspace, productionId);
  const videoUrl = await saveAsset(workspace, production.id, "clip", new File([new Uint8Array(bytes)], "video.mp4", { type: "video/mp4" }));
  await put(workspace, "production_evidence", { id: production.id, sessionId: production.sessionId, report, inspection, rawFileId: raw.id, providerFileId: video.id, observedAt: new Date().toISOString(), verification: "Media structure validated; gameplay actions are agent-reported and require human review." });
  const next: VideoProduction = { ...importing, videoUrl, state: "ready", error: undefined, updatedAt: new Date().toISOString() };
  if (!await comparePut(workspace, "video_production", importing, next)) return productionRecord(workspace, productionId);
  return next;
}
