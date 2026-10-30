import {referenceContext,referenceLibrary,referenceSetRevision,rubricRevision,referenceStructure,selectContentReferences} from "./content-references";
import { approvalJson } from "./approval-json";
import { reviewedScript, type ContentScript, type ScriptReview } from "./content-scripts";
import { z } from "zod";
import { comparePut, get, list, put, query, transaction, type TransactionQuery } from "./db";
import { hash } from "./security";
import { HttpError } from "./http-error";
import { readAISettings } from "./ai-settings";
import { secretForConnection } from "./credentials";
import { gameSources } from "./content-studio-sources";
import { mediaStorageConfigured, mediaRecord, saveAsset } from "./media";
import { managedFileBytes, managedOutputFiles, readManagedSession, startManagedSession } from "./managed-gameplay-agent";
import type { Connection, Game } from "./types";
import type { ContentIdea, IdeaSchedule, PilotGrant, PilotReview, StudioSnapshot, VideoProduction } from "./content-studio-contract";
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
type ProviderConfig = { id: "default"; connectionId: string; agentId: string; agentVersion: number; environmentId: string; revision: string; pilotVerified: boolean; networkPolicyVerified: boolean; organizationVerified: boolean; watchdogVerified: boolean; watchdogAdmissionVerified?: boolean;
  reviewedGames?: Record<string, { sourceRevision: string; gameAudioVerified: boolean }> };
export const dubaiDate = (date = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dubai", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
const getGame = async (workspace: string, gameId: string) => {
  const game = await get<Game>(workspace, "game", gameId);
  if (!game) throw new HttpError(404, "Game not found.");
  return game;
};
export { gameSources } from "./content-studio-sources";
export async function studioReadiness(workspace: string, mode: "production" | "pilot" = "production") {
  const [config, selected, connections] = await Promise.all([
    get<ProviderConfig>(workspace, "content_provider", "default"), readAISettings(workspace).catch(() => null), list<Connection>(workspace, "connection"),
  ]);
  const connection = connections.find(c => c.id === (config?.connectionId || selected?.connectionId) && c.provider === "anthropic" && c.connected);
  const reasons: string[] = [];
  if (!connection) reasons.push("Select the existing direct Anthropic key in Account settings. OpenRouter/Jev credits are separate.");
  if (!config?.agentId || !config.environmentId) reasons.push("Link the reviewed Claude producer agent and restricted cloud environment to Blaze.");
  if (!config?.organizationVerified) reasons.push("Verify that the saved Anthropic key belongs to the credit-bearing organization.");
  if (!config?.networkPolicyVerified) reasons.push("Review the cloud environment's game and asset host allowlist.");
  if (mode === "production" && !config?.pilotVerified) reasons.push("Approve one bounded cloud gameplay pilot to verify controls, WebGL, recording and any required audio.");
  if (mode === "production" && !config?.watchdogVerified) reasons.push("Verify a monitored 30-minute cloud-session stop before enabling production.");
  if (mode === "pilot" && !config?.watchdogAdmissionVerified) reasons.push("Verify the independent pilot watchdog's no-spend heartbeat, stale-monitor and recovery checks.");
  if (!config || !await watchdogReady(workspace, config.revision)) reasons.push("A fresh, healthy cloud-runtime watchdog heartbeat is required.");
  if (await unresolvedProduction(workspace)) reasons.push("An earlier cloud start, stop or runtime deadline needs reconciliation before another attempt.");
  if (mode === "production" && process.env.BLAZE_CLOUD_PRODUCTION_ENABLED !== "true") reasons.push("Cloud production is disabled pending setup and pilot approval.");
  if (mode === "pilot" && process.env.BLAZE_CLOUD_PILOT_ENABLED !== "true") reasons.push("Single-use operator pilots are disabled pending explicit approval.");
  if (!mediaStorageConfigured()) reasons.push("Configure Blaze private video storage.");
  return { ready: reasons.length === 0, reasons, provider: "anthropic_managed_agents" as const, connectionLabel: connection?.label };
}
export async function studioSnapshot(workspace: string, gameId?: string, actor?: string): Promise<StudioSnapshot> {
  if (gameId) await getGame(workspace, gameId);
  const [ideas, productions, schedule, readiness] = await Promise.all([
    list<ContentIdea>(workspace, "content_idea"), list<VideoProduction>(workspace, "video_production"),
    get<IdeaSchedule>(workspace, "idea_schedule", "default"), studioReadiness(workspace),
  ]);
  const activeGames = new Set((await list<Game>(workspace, "game")).map(game => game.id));
  const visibleIdeas = ideas.filter(v => activeGames.has(v.gameId) && (!gameId || v.gameId === gameId));
  const [savedScripts, reviews] = await Promise.all([list<ContentScript>(workspace, "content_script"), list<ScriptReview>(workspace, "script_review")]);
  const sources = new Map(await Promise.all([...new Set(visibleIdeas.map(i=>i.gameId))].map(async id => [id, await gameSources(workspace,id).catch(()=>null)] as const)));
  const scripts = savedScripts.filter(s=>visibleIdeas.some(i=>i.id===s.ideaId)).map(s=>{
    const source = sources.get(s.gameId);
    const sourceStale = s.sourceRevision !== source?.revision;
    const currentContext=source?referenceContext(source):null;const contextStale=s.reviewContextRevision!==currentContext?.reviewContextRevision;
    const history=reviews.filter(r=>r.scriptId===s.id).sort((a,b)=>b.approvedAt.localeCompare(a.approvedAt)||b.id.localeCompare(a.id));
    const review=history.find(r=>r.scriptRevision===s.revision&&r.sourceRevision===s.sourceRevision);
    const accepted=!sourceStale&&!contextStale&&review?.state==="complete"&&review.reviewContextRevision===currentContext?.reviewContextRevision&&!!review.score;
    const historical=history.find(r=>r.state==="complete"&&r.score);
    return {ideaId:s.ideaId,text:s.text,sourceStale,contextStale,referenceIds:s.referenceIds||[],referenceSetRevision:s.referenceSetRevision,rubricRevision:s.rubricRevision,scoreReferenceSetRevision:(accepted?review:historical)?.referenceSetRevision,reviewState:sourceStale||contextStale?"stale":review?.state,...(accepted?{score:review!.score}:historical?.score?{staleScore:historical.score}:{})};
  });
  const referenceSource=gameId?(sources.get(gameId)||await gameSources(workspace,gameId).catch(()=>null)):null;
  return { sourceFacts:[...sources.values()].flatMap(source=>source?[{gameId:source.gameId,sourceRevision:source.revision,facts:source.facts.map(({key,value})=>({key,value}))}]:[]), references:{setId:referenceLibrary.set_id,revision:referenceSetRevision,rubricRevision,selected:referenceSource?selectContentReferences(referenceSource).map(x=>({id:x.reference.id,relevance:x.relevance})):[]}, scripts, ideas: ideas.filter(v => activeGames.has(v.gameId) && (!gameId || v.gameId === gameId)), productions: productions.filter(v => activeGames.has(v.gameId) && (!gameId || v.gameId === gameId)), schedule: schedule || defaultSchedule, readiness, ...(pilotOperator(workspace, actor) ? { pilot: { operator: true, ...await studioReadiness(workspace, "pilot") } } : {}) };
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
  const context=referenceContext(source);
  const candidates = [
    { angle: "first_play", title: `First play: ${source.title}`, hook: `What happens when you play ${source.title}?`, treatment: "Show the real entry into play, one readable action and its observed outcome.", shots: ["Open the actual game", "Show a supported action", "Hold on its real result"] },
    { angle: "how_to_play", title: `How to play ${source.title}`, hook: "See the controls in action.", treatment: "Demonstrate only controls documented by the game. Tie each caption to the action on screen.", shots: ["Show documented controls", "Perform the corresponding action", "Show what changed"] },
    { angle: "one_sequence", title: `A play sequence in ${source.title}`, hook: "One action and its actual result.", treatment: "Follow one genuine play sequence. Keep its order and do not imply a win unless captured.", shots: ["Begin a real play sequence", "Capture a meaningful decision", "Show the observed outcome"] },
  ].filter(c => c.angle !== "how_to_play" || source.facts.some(f => f.key === "manifest_controls"));
  const ideas: ContentIdea[] = [];
  for (const candidate of candidates.slice(0, schedule.countPerGame)) {
    const fingerprint = hash(`${source.revision}:${context.reviewContextRevision}:${candidate.angle}`);
    const idea: ContentIdea = { id: `idea_${hash(`${workspace}:${gameId}:${fingerprint}`).slice(0, 32)}`, gameId,
      title: candidate.title, hook: candidate.hook, treatment: `${candidate.treatment} ${referenceStructure}`, referenceSetRevision:context.referenceSetRevision,referenceIds:context.referenceIds,rubricRevision:context.rubricRevision, shots: candidate.shots,
      factKeys: source.facts.map(f => f.key), sourceRevision: source.revision, createdAt: new Date().toISOString(), origin: "source_outline", fingerprint };
    await query(`INSERT INTO records(workspace_id,kind,id,body) VALUES($1,'content_idea',$2,$3::jsonb) ON CONFLICT DO NOTHING`, [workspace, idea.id, JSON.stringify(idea)]);
    ideas.push(idea);
  }
  return ideas;
}
const pilotOperator = (workspace: string, actor?: string) => !!actor &&
  !!process.env.BLAZE_CLOUD_PILOT_OPERATOR_ID && actor === process.env.BLAZE_CLOUD_PILOT_OPERATOR_ID &&
  !!process.env.BLAZE_CLOUD_PILOT_WORKSPACE_ID && workspace === process.env.BLAZE_CLOUD_PILOT_WORKSPACE_ID;
function requirePilotOperator(workspace: string, actor?: string) {
  if (!pilotOperator(workspace, actor)) throw new HttpError(403, "This workspace operator is not authorized for pilot admission.");
}
const pilotProvider = (config: ProviderConfig) => ({ connectionId: config.connectionId, agentId: config.agentId, agentVersion: config.agentVersion, environmentId: config.environmentId, revision: config.revision });
function pilotReviewHash(workspace: string, actor: string, source: Awaited<ReturnType<typeof gameSources>>, idea: ContentIdea, settings: VideoProduction["settings"], maxListCostCents: number, config: ProviderConfig, credentialRevision: string, script: Awaited<ReturnType<typeof reviewedScript>>) {
  return hash(approvalJson({ purpose: "single_cloud_gameplay_pilot", workspace, actor, source, idea, settings, maxListCostCents, provider: pilotProvider(config), configurationHash: hash(approvalJson(config)), credentialRevision, script: { id: script.script.id, revision: script.script.revision, text: script.script.text, reviewId: script.review.id, score: script.review.score } }));
}
export async function reviewPilotVideo(workspace: string, actor: string, input: { ideaId: string; settings: unknown; maxListCostCents: number }): Promise<PilotReview> {
  requirePilotOperator(workspace, actor);
  const settings = videoSettingsSchema.parse(input.settings);
  const ceiling = Number(process.env.BLAZE_CLOUD_PILOT_MAX_LIST_COST_CENTS || "100");
  if (!Number.isInteger(ceiling) || ceiling < 1 || ceiling > 5000) throw new HttpError(409, "Pilot threshold configuration is invalid.");
  z.number().int().min(1).max(ceiling).parse(input.maxListCostCents);
  const idea = await get<ContentIdea>(workspace, "content_idea", input.ideaId);
  if (!idea) throw new HttpError(404, "Idea not found.");
  if (!process.env.BLAZE_CLOUD_PILOT_GAME_ID || idea.gameId !== process.env.BLAZE_CLOUD_PILOT_GAME_ID) throw new HttpError(403, "This game is not the explicitly configured pilot target.");
  const source = await gameSources(workspace, idea.gameId);
  if (source.revision !== idea.sourceRevision) throw new HttpError(409, "Game evidence changed; review a fresh idea.");
  const config = await get<ProviderConfig>(workspace, "content_provider", "default");
  if (!config?.agentId || !config.environmentId || !Number.isInteger(config.agentVersion) || config.agentVersion < 1) throw new HttpError(409, "Link the reviewed agent version and restricted environment before reviewing a pilot.");
  const credentialRevision = await credentialFingerprint(workspace, config.connectionId);
  const script = await reviewedScript(workspace, idea.id, source.revision);
  const readiness = await studioReadiness(workspace, "pilot");
  return { reviewHash: pilotReviewHash(workspace, actor, source, idea, settings, input.maxListCostCents, config, credentialRevision, script),
    gameId: idea.gameId, ideaId: idea.id, sourceRevision: source.revision, provider: pilotProvider(config), settings, maxListCostCents: input.maxListCostCents, ready: readiness.ready, reasons: readiness.reasons };
}
export async function approvePilotVideo(workspace: string, actor: string, input: { ideaId: string; settings: unknown; maxListCostCents: number; requestId: string; reviewHash: string }) {
  const reviewed = await reviewPilotVideo(workspace, actor, input);
  z.string().uuid().parse(input.requestId);
  if (reviewed.reviewHash !== input.reviewHash) throw new HttpError(409, "The pilot review changed. Inspect the exact setup and approve it again.");
  if (!reviewed.ready) throw new HttpError(409, reviewed.reasons.join(" "));
  const stamp = new Date().toISOString(), expiresAt = new Date(Date.now() + 15 * 60000).toISOString();
  const productionId = `production_${hash(`${workspace}:pilot:${input.requestId}`).slice(0, 32)}`;
  const grantId = `pilot_${hash(`${workspace}:${input.requestId}`).slice(0, 32)}`;
  return transaction(async sql => {
    const config = (await sql<{ body: ProviderConfig }>(`SELECT body FROM records WHERE workspace_id=$1 AND kind='content_provider' AND id='default' FOR UPDATE`, [workspace]))[0]?.body;
    if (!config) throw new HttpError(409, "Producer setup changed.");
    const source = await gameSources(workspace, reviewed.gameId, sql);
    const idea = (await sql<{ body: ContentIdea }>(`SELECT body FROM records WHERE workspace_id=$1 AND kind='content_idea' AND id=$2 FOR UPDATE`, [workspace, input.ideaId]))[0]?.body;
    const encrypted = (await sql<{ encrypted: string }>(`SELECT encrypted FROM credentials WHERE workspace_id=$1 AND provider=$2 FOR UPDATE`, [workspace, config.connectionId]))[0]?.encrypted;
    if (!idea || !encrypted) throw new HttpError(409, "Pilot inputs changed before approval.");
    const script = await reviewedScript(workspace, idea.id, source.revision, sql);
    if (pilotReviewHash(workspace, actor, source, idea, reviewed.settings, input.maxListCostCents, config, hash(encrypted), script) !== input.reviewHash) throw new HttpError(409, "Pilot inputs changed before approval; review again.");
    const old = (await sql<{ body: PilotGrant }>(`SELECT body FROM records WHERE workspace_id=$1 AND kind='pilot_grant' AND id=$2`, [workspace, grantId]))[0]?.body;
    if (old) {
      if (old.reviewHash !== input.reviewHash) throw new HttpError(409, "This pilot request already approved different inputs.");
      const prior = (await sql<{ body: VideoProduction }>(`SELECT body FROM records WHERE workspace_id=$1 AND kind='video_production' AND id=$2`, [workspace, old.productionId]))[0]?.body;
      if (!prior) throw new HttpError(409, "Pilot grant needs reconciliation.");
      return prior; // Never renew expiry or reset a consumed/cancelled attempt.
    }
    if (await unresolvedProduction(workspace, undefined, Date.now(), sql)) throw new HttpError(409, "Earlier cloud work needs reconciliation.");
    await sql(`UPDATE records SET body=body || '{"state":"failed","error":"Unused pilot approval expired; fresh approval is required."}'::jsonb,updated_at=now() WHERE workspace_id=$1 AND kind='video_production' AND body ? 'pilotGrantId' AND body->>'state'='approved' AND (body->>'expiresAt')::timestamptz<=now()`,[workspace]);
    const active = await sql(`SELECT id FROM records WHERE workspace_id=$1 AND kind='video_production' AND body ? 'pilotGrantId' AND body->>'state' IN ('approved','starting','running','importing','cancel_requested','needs_reconciliation') LIMIT 1`, [workspace]);
    if (active.length) throw new HttpError(409, "A pilot already has an approved or active attempt. Inspect it before granting another.");
    const credentialRevision = hash(encrypted);
    const production: VideoProduction = { id: productionId, gameId: idea.gameId, ideaId: idea.id, idea, settings: reviewed.settings,
      state: "approved", scriptId: script.script.id, scriptRevision: script.script.revision, scriptReviewId: script.review.id, scriptText: script.script.text, pilotGrantId: grantId, approvedBy: actor, approvedAt: stamp, createdAt: stamp, updatedAt: stamp, expiresAt,
      approvalHash: input.reviewHash, sourceRevision: source.revision, providerRevision: config.revision, credentialRevision, maxListCostCents: input.maxListCostCents };
    const grant: PilotGrant = { id: grantId, workspaceId: workspace, productionId, approvedBy: actor, approvedAt: stamp, expiresAt,
      reviewHash: input.reviewHash, gameId: idea.gameId, ideaId: idea.id, sourceRevision: source.revision, providerRevision: config.revision,
      credentialRevision, ...pilotProvider(config), settings: reviewed.settings, maxListCostCents: input.maxListCostCents, state: "approved" };
    await sql(`INSERT INTO records(workspace_id,kind,id,body) VALUES($1,'pilot_grant',$2,$3::jsonb),($1,'video_production',$4,$5::jsonb)`, [workspace, grantId, JSON.stringify(grant), productionId, JSON.stringify(production)]);
    return production;
  });
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
  const script = await reviewedScript(workspace, idea.id, source.revision);
  const credentialRevision = await credentialFingerprint(workspace, config.connectionId);
  const now = new Date().toISOString();
  const production: VideoProduction = { id: `production_${hash(`${workspace}:${input.requestId}`).slice(0, 32)}`, gameId: idea.gameId, ideaId: idea.id, idea,
    settings, scriptId: script.script.id, scriptRevision: script.script.revision, scriptReviewId: script.review.id, scriptText: script.script.text, state: "approved", approvedBy: actor, approvedAt: now, createdAt: now, updatedAt: now, expiresAt: new Date(Date.now() + 15 * 60000).toISOString(),
    sourceRevision: source.revision, providerRevision: config.revision, credentialRevision, maxListCostCents: input.maxListCostCents,
    approvalHash: hash(JSON.stringify({ idea, settings, maxListCostCents: input.maxListCostCents, sourceRevision: source.revision, providerRevision: config.revision, credentialRevision, script: { id: script.script.id, revision: script.script.revision, reviewId: script.review.id } })) };
  return transaction(async sql => {
    const lockedSource = await gameSources(workspace, idea.gameId, sql);
    const lockedScript = await reviewedScript(workspace, idea.id, lockedSource.revision, sql);
    if (lockedSource.revision !== source.revision || lockedScript.script.revision !== script.script.revision || lockedScript.review.id !== script.review.id) throw new HttpError(409, "Script or source changed before video approval.");
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
export async function startApprovedVideo(workspace: string, productionId: string, actor?: string) {
  const production = await productionRecord(workspace, productionId);
  if (production.pilotGrantId) {
    requirePilotOperator(workspace, actor);
    if (!process.env.BLAZE_CLOUD_PILOT_GAME_ID || production.gameId !== process.env.BLAZE_CLOUD_PILOT_GAME_ID) throw new HttpError(403, "The configured pilot target changed. No request was sent.");
  }
  if (production.state !== "approved") return production;
  const source = await gameSources(workspace, production.gameId);
  if (Date.parse(production.expiresAt) <= Date.now() || source.revision !== production.sourceRevision) {
    const failed = { ...production, state: "failed" as const, error: "Approval expired or game evidence changed. Review and approve a new run.", updatedAt: new Date().toISOString() };
    await comparePut(workspace, "video_production", production, failed); return failed;
  }
  if (!(await studioReadiness(workspace, production.pilotGrantId ? "pilot" : "production")).ready) throw new HttpError(409, "Cloud production is paused. No request was sent.");
  const { config, secret } = await providerSecret(workspace, production.providerRevision);
  if (await credentialFingerprint(workspace, config.connectionId) !== production.credentialRevision) throw new HttpError(409, "The saved key changed. Review and approve a new run.");
  const scriptSnapshot = await reviewedScript(workspace, production.ideaId, production.sourceRevision);
  if (scriptSnapshot.script.id !== production.scriptId || scriptSnapshot.script.revision !== production.scriptRevision || scriptSnapshot.review.id !== production.scriptReviewId || scriptSnapshot.script.text !== production.scriptText) throw new HttpError(409, "Script or Jev review changed. Approve the exact current version again.");
  const dispatchAt = Date.now();
  const starting: VideoProduction = { ...production, state: "starting", updatedAt: new Date(dispatchAt).toISOString(), startedAt: new Date(dispatchAt).toISOString(), watchdogDeadlineAt: new Date(dispatchAt + PRODUCTION_RUNTIME_MS).toISOString(), usage: { status: "unavailable" } };
  const reserved = await transaction(async sql => {
    // Serialize starts across all games, independently of the last watchdog heartbeat.
    const provider = (await sql<{ body: ProviderConfig }>(`SELECT body FROM records WHERE workspace_id=$1 AND kind='content_provider' AND id='default' FOR UPDATE`, [workspace]))[0]?.body;
    if (!provider || hash(approvalJson(provider)) !== hash(approvalJson(config))) throw new HttpError(409, "Producer setup changed before dispatch.");
    if (await unresolvedProduction(workspace, production.id, dispatchAt, sql)) throw new HttpError(409, "An earlier cloud start, stop or runtime deadline needs reconciliation before another attempt.");
    const lockedSource = await gameSources(workspace, production.gameId, sql);
    if (lockedSource.revision !== production.sourceRevision) throw new HttpError(409, "Game evidence changed before dispatch.");
    const currentProduction = (await sql<{ body: VideoProduction }>(`SELECT body FROM records WHERE workspace_id=$1 AND kind='video_production' AND id=$2 FOR UPDATE`, [workspace, productionId]))[0]?.body;
    if (!currentProduction || JSON.stringify(currentProduction) !== JSON.stringify(production)) return false;
    const encrypted = (await sql<{ encrypted: string }>(`SELECT encrypted FROM credentials WHERE workspace_id=$1 AND provider=$2 FOR UPDATE`, [workspace, config.connectionId]))[0]?.encrypted;
    if (!encrypted || hash(encrypted) !== production.credentialRevision) throw new HttpError(409, "Producer key changed before dispatch.");
    const script = await reviewedScript(workspace, production.ideaId, production.sourceRevision, sql);
    if (script.script.id !== production.scriptId || script.script.revision !== production.scriptRevision || script.review.id !== production.scriptReviewId) throw new HttpError(409, "Script or Jev review changed before dispatch.");
    if (production.pilotGrantId) {
      const grant = (await sql<{ body: PilotGrant }>(`SELECT body FROM records WHERE workspace_id=$1 AND kind='pilot_grant' AND id=$2 FOR UPDATE`, [workspace, production.pilotGrantId]))[0]?.body;
      if (!grant || grant.state !== "approved" || grant.workspaceId !== workspace || grant.productionId !== production.id || grant.approvedBy !== actor || Date.parse(grant.expiresAt) <= dispatchAt ||
        grant.reviewHash !== production.approvalHash || pilotReviewHash(workspace, actor!, lockedSource, production.idea, production.settings, production.maxListCostCents, config, production.credentialRevision, script) !== grant.reviewHash)
        throw new HttpError(409, "Pilot grant is expired, consumed or does not match this exact attempt.");
      await sql(`UPDATE records SET body=body || $3::jsonb,updated_at=now() WHERE workspace_id=$1 AND kind='pilot_grant' AND id=$2`, [workspace, grant.id, JSON.stringify({ state: "consumed", consumedAt: new Date(dispatchAt).toISOString() })]);
    }
    return (await sql(`UPDATE records SET body=$4::jsonb,updated_at=now() WHERE workspace_id=$1 AND kind='video_production' AND id=$2 AND body=$3::jsonb RETURNING id`, [workspace, productionId, JSON.stringify(production), JSON.stringify(starting)])).length > 0;
  });
  if (!reserved) return productionRecord(workspace, productionId);
  try {
    const session = await startManagedSession(secret, { agentId: config.agentId, agentVersion: config.agentVersion, environmentId: config.environmentId,
      budgetCents: production.maxListCostCents, prompt: JSON.stringify({ productionId, source, idea: production.idea, script: { text: production.scriptText, revision: production.scriptRevision, jevReview: scriptSnapshot.review.score }, settings: production.settings,
        requiredOutputs: ["video.mp4", "evidence.json", "raw capture"], instructions: "Actively play the real game in the cloud, capture footage and edit this exact approved script. Never publish. In evidence.json gameUrl must equal the initially requested source.url; record the actual final browser URL and any approved redirects in limitations. Stop if navigation requires an unapproved origin." }) });
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
