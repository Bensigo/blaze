import {randomUUID} from "node:crypto";
import {referenceContext,referenceSetRevision,rubricRevision} from "./content-references";
import { CONTENT_GENERATION_SYSTEM, generatedContentSchema, recentContentRejections, recentContentIdeas, buildContentPrompt, currentReviewBinding, sameReviewBinding, scoreGeneratedScript, type ReviewBinding } from "./on-demand-content";
import { saveContentScript, type ContentScript } from "./content-scripts";
import { generateText } from "ai";
import { aiModel } from "./ai-provider";
import { resolveAISecret, type AISettings } from "./ai-settings";
import { comparePut, get, list, query, transaction, type TransactionQuery } from "./db";
import { hash } from "./security";
import { dubaiDate, gameSources } from "./content-studio";
import type { ContentIdea, IdeaSchedule } from "./content-studio-contract";
import type { Connection, Game } from "./types";
import type { DailyContentGrant } from "./daily-content-consent";

export type IdeaBatch = { id: string; gameId: string; day: string; state: "starting" | "scoring" | "complete" | "failed" | "needs_reconciliation"; reviewReserved?:number; approvedBy?:string; reviewerBinding?:ReviewBinding; grantHash?:string; scoredIdeaIds?:string[]; scoringIdeaId?:string; scoringReservationId?:string; scriptRevisions?:Record<string,string>; createdAt: string; ideaIds?: string[]; error?: string; usage?: { inputTokens?: number; outputTokens?: number; costStatus: "unavailable" };referenceSetRevision?:string;referenceIds?:string[];rubricRevision?:string };
export const ideaScheduleHash = (schedule: IdeaSchedule) => hash(JSON.stringify([schedule.countPerGame, schedule.localTime, schedule.timeZone, schedule.enabled, schedule.maxOutputTokensPerGame,referenceSetRevision,rubricRevision,"daily-generated-and-scored-v3"]));

// Called by an explicitly approved scheduler, never on a page read or profile refresh.
// Saving schedule preferences in the UI does not enable this runner.
export async function runDailyIdeas(workspace: string, now = new Date()) {
  const startedAt=Date.now();
  const schedule = await get<IdeaSchedule>(workspace, "idea_schedule", "default");
  if (process.env.BLAZE_DAILY_IDEAS_ENABLED !== "true" || process.env.BLAZE_ON_DEMAND_CONTENT_ENABLED !== "true" || !schedule?.enabled || !schedule.localTime) return { paused: true, batches: [] as IdeaBatch[] };
  const authorization = await get<DailyContentGrant>(workspace, "daily_idea_authorization", "default");
  if (!authorization || Date.parse(authorization.expiresAt) <= now.getTime() || !Number.isFinite(Date.parse(authorization.expiresAt)) || authorization.scheduleHash !== ideaScheduleHash(schedule)) return { paused: true, batches: [] as IdeaBatch[] };
  if (!Array.isArray(authorization.gameIds) || !authorization.gameIds.length || !authorization.sourceRevisions || !authorization.reviewContextRevisions || !authorization.generationBinding) return {paused:true,batches:[] as IdeaBatch[]};
  const consent=authorization.scoreConsent;
  if (!authorization.approvedBy || !consent || consent.maxCostCentsPerReview!==1 || consent.countPerGame!==schedule.countPerGame || !Number.isSafeInteger(consent.maxReviewsPerDay) || consent.maxReviewsPerDay<schedule.countPerGame || consent.maxReviewsPerDay>100 || !consent.reviewerBinding) return { paused:true, batches:[] as IdeaBatch[] };
  const reviewConfig=await currentReviewBinding(workspace).catch(()=>null);
  if (!reviewConfig?.availability.enabled || !sameReviewBinding(reviewConfig,consent.reviewerBinding)) return { paused:true, batches:[] as IdeaBatch[] };
  const localTime = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Dubai", hour: "2-digit", minute: "2-digit", hour12: false }).format(now);
  if (localTime < schedule.localTime) return { paused: false, batches: [] as IdeaBatch[] };
  const day = dubaiDate(now); const batches: IdeaBatch[] = [];
  for (const game of (await list<Game>(workspace, "game")).filter(g=>authorization.gameIds.includes(g.id))) {
    const batch: IdeaBatch = { id: `ideas_${hash(`${workspace}:${game.id}:${day}`).slice(0, 32)}`, gameId: game.id, day, state: "starting", createdAt: now.toISOString(), reviewReserved: schedule.countPerGame, approvedBy: authorization.approvedBy, reviewerBinding: consent.reviewerBinding, grantHash: hash(JSON.stringify(authorization)) };
    const claimed = await transaction(async sql => {
      const currentSchedule=(await sql<{body:IdeaSchedule}>(`SELECT body FROM records WHERE workspace_id=$1 AND kind='idea_schedule' AND id='default' FOR UPDATE`,[workspace]))[0]?.body;
      if (!currentSchedule?.enabled || ideaScheduleHash(currentSchedule)!==authorization.scheduleHash) return [];
      const grant=(await sql<{body:typeof authorization}>(`SELECT body FROM records WHERE workspace_id=$1 AND kind='daily_idea_authorization' AND id='default' FOR UPDATE`,[workspace]))[0]?.body;
      if (!grant || hash(JSON.stringify(grant))!==hash(JSON.stringify(authorization)) || !Number.isFinite(Date.parse(grant.expiresAt)) || Date.parse(grant.expiresAt)<=now.getTime()+Math.max(0,Date.now()-startedAt)) return [];
      if (!(await sql(`SELECT id FROM records WHERE workspace_id=$1 AND kind='game' AND id=$2 FOR UPDATE`, [workspace, game.id])).length) return [];
      if (!grant.gameIds?.includes(game.id) || grant.sourceRevisions?.[game.id]!==authorization.sourceRevisions[game.id] || grant.reviewContextRevisions?.[game.id]!==authorization.reviewContextRevisions[game.id]) return [];
      const source=await gameSources(workspace,game.id,sql);
      if (source.revision!==grant.sourceRevisions[game.id] || referenceContext(source).reviewContextRevision!==grant.reviewContextRevisions[game.id]) return [];
      const binding=grant.generationBinding;
      const settings=(await sql<{body:AISettings}>(`SELECT body FROM records WHERE workspace_id=$1 AND kind='ai_settings' AND id='default' FOR UPDATE`,[workspace]))[0]?.body;
      const connection=(await sql<{body:Connection}>(`SELECT body FROM records WHERE workspace_id=$1 AND kind='connection' AND id=$2 FOR UPDATE`,[workspace,binding.connectionId]))[0]?.body;
      const encrypted=(await sql<{encrypted:string}>(`SELECT encrypted FROM credentials WHERE workspace_id=$1 AND provider=$2 FOR UPDATE`,[workspace,binding.connectionId]))[0]?.encrypted;
      if (!settings || !connection?.connected || !encrypted || binding.provider!=="anthropic" || settings.provider!==binding.provider || settings.connectionId!==binding.connectionId || settings.model!==binding.model || connection.provider!==binding.provider || connection.model!==binding.model || (settings.revision || `legacy-${hash(JSON.stringify(settings))}`)!==binding.settingsRevision || (connection.credentialVersion || `legacy-${hash(encrypted)}`)!==binding.credentialRevision || grant.aiSettingsRevision!==binding.settingsRevision || grant.credentialVersion!==binding.credentialRevision) return [];
      const existing=await sql<{body:IdeaBatch}>(`SELECT body FROM records WHERE workspace_id=$1 AND kind='idea_batch' AND body->>'day'=$2`,[workspace,day]);
      const used=existing.reduce((sum,row)=>sum+(Number.isSafeInteger(row.body.reviewReserved) ? row.body.reviewReserved! : 0),0);
      if (used+schedule.countPerGame>consent.maxReviewsPerDay) return [];
      return sql(`INSERT INTO records(workspace_id,kind,id,body) VALUES($1,'idea_batch',$2,$3::jsonb) ON CONFLICT DO NOTHING RETURNING id`, [workspace, batch.id, JSON.stringify(batch)]);
    });
    if (!claimed.length) continue; // Even a failed/uncertain request is consumed for this date.
    try {
      const source = await gameSources(workspace, game.id);
      if (source.revision!==authorization.sourceRevisions[game.id] || referenceContext(source).reviewContextRevision!==authorization.reviewContextRevisions[game.id]) throw new Error("Game source changed");
      const references=referenceContext(source);batch.referenceSetRevision=references.referenceSetRevision;batch.referenceIds=references.referenceIds;batch.rubricRevision=references.rubricRevision;
      const previous = await recentContentIdeas(workspace, game.id);
      const secret = await resolveAISecret(workspace, false);
      if (secret.aiProvider !== "anthropic") throw new Error("Choose the existing direct Anthropic connection; this daily runner does not spend OpenRouter credits.");
      if (secret.aiSettingsRevision !== authorization.aiSettingsRevision || secret.aiCredentialVersion !== authorization.credentialVersion || secret.aiConnectionId !== authorization.generationBinding.connectionId || secret.model !== authorization.generationBinding.model) throw new Error("Daily provider approval no longer matches the saved selection.");
      // Token bound + no retries; monetary list cost is not observable here. Do not call this a hard dollar cap.
      const rejectedPatterns = await recentContentRejections(workspace, game.id);
      const {prompt} = buildContentPrompt(schedule.countPerGame, source, references.referenceSummaries, rejectedPatterns, previous);
      const result = await generateText({ model: aiModel(secret), maxRetries: 0, maxOutputTokens: schedule.maxOutputTokensPerGame, abortSignal: AbortSignal.timeout(20000), system: CONTENT_GENERATION_SYSTEM, prompt });
      const parsed = generatedContentSchema.parse(JSON.parse(result.text));
      if (parsed.ideas.length !== schedule.countPerGame) throw new Error("The model returned the wrong number of ideas.");
      const validKeys = new Set(source.facts.map(f => f.key));
      const fingerprints = new Set(previous.map(i => i.fingerprint));
      const rejectedTitles = new Set(rejectedPatterns.map(r => typeof r.title === "string" ? r.title.trim().toLowerCase() : "").filter(Boolean));
      const ideas = parsed.ideas.map((item) => {
        const { script, ...idea } = item;
        if (idea.factKeys.some(key => !validKeys.has(key))) throw new Error("The idea cites an unknown game fact.");
        const fingerprint = hash(`${idea.title.trim().toLowerCase()}:${idea.treatment.trim().toLowerCase()}`);
        if (rejectedTitles.has(idea.title.trim().toLowerCase()) || fingerprints.has(fingerprint) || previous.some(p => p.title.toLowerCase() === idea.title.toLowerCase())) throw new Error("The ideas repeat prior proposals. No automatic retry was made.");
        fingerprints.add(fingerprint);
        return { script, idea: { ...idea, id: `idea_${hash(`${workspace}:${game.id}:${fingerprint}`).slice(0,32)}`, gameId: game.id, sourceRevision: source.revision, createdAt: now.toISOString(), origin: "daily_agent", fingerprint,referenceSetRevision:references.referenceSetRevision,referenceIds:references.referenceIds,rubricRevision:references.rubricRevision } as ContentIdea };
      });
      await transaction(async sql => {
        const current = await gameSources(workspace, game.id, sql);
        if (current.revision !== source.revision || referenceContext(current).reviewContextRevision !== references.reviewContextRevision) throw new Error("Source changed");
        for (const { idea } of ideas) await sql(`INSERT INTO records(workspace_id,kind,id,body) VALUES($1,'content_idea',$2,$3::jsonb)`, [workspace, idea.id, JSON.stringify(idea)]);
      });
      batch.ideaIds = ideas.map(i => i.idea.id);
      const scripts: ContentScript[] = [];
      for (const { idea, script } of ideas) scripts.push(await saveContentScript(workspace, idea.id, script, undefined, "generated"));
      batch.scoredIdeaIds = []; batch.scriptRevisions = Object.fromEntries(ideas.map((item,i)=>[item.idea.id,scripts[i].revision]));
      batch.state = "scoring"; batch.ideaIds = ideas.map(i => i.idea.id); batch.usage = { inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens, costStatus: "unavailable" };
      await query(`UPDATE records SET body=$3::jsonb,updated_at=now() WHERE workspace_id=$1 AND kind='idea_batch' AND id=$2`, [workspace, batch.id, JSON.stringify(batch)]);
    } catch {
      batch.state = "failed"; batch.error = "Daily generation did not complete. Check provider setup and source facts. This date will not be retried automatically.";
      await query(`UPDATE records SET body=$3::jsonb,updated_at=now() WHERE workspace_id=$1 AND kind='idea_batch' AND id=$2`, [workspace, batch.id, JSON.stringify(batch)]);
    }
    batches.push(batch);
    break; // One generation per invocation.
  }
  return { paused: false, batches };
}

// Count actual dispatches on the Dubai day, including carry-over and uncertain calls.
// Legacy same-day markers without a ledger entry still consume their quota.
async function dailyReviewCount(sql: TransactionQuery, workspace: string, day: string, unstartedPair?:string) {
  const dispatches = await sql<{body:{batchId:string;ideaId:string;day:string}}>(`SELECT body FROM records WHERE workspace_id=$1 AND kind='daily_review_dispatch'`, [workspace]);
  const dispatched = new Set(dispatches.map(row => JSON.stringify([row.body.batchId,row.body.ideaId])));
  const legacy = await sql<{body:IdeaBatch}>(`SELECT body FROM records WHERE workspace_id=$1 AND kind='idea_batch' AND body->>'day'=$2`, [workspace,day]);
  let used = dispatches.filter(row => row.body.day === day).length;
  for (const {body:batch} of legacy) {
    const attempts = new Set([...(batch.scoredIdeaIds || []), ...(batch.scoringIdeaId ? [batch.scoringIdeaId] : [])]);
    for (const ideaId of attempts) if (JSON.stringify([batch.id,ideaId])!==unstartedPair && !dispatched.has(JSON.stringify([batch.id,ideaId]))) used++;
  }
  return used;
}

class DailyDispatchDeferred extends Error {
  constructor(readonly quotaReached:boolean) {super("Daily review not dispatched");}
}
// Keep daily requests out of the 30-second rollover window (review timeout 15s).
function dispatchWindow(now:number) {
  const day=dubaiDate(new Date(now));
  const end=Date.parse(`${day}T20:00:00Z`); // Dubai midnight ending this date.
  return {day,open:end-now>30000};
}
/** Process at most one granted daily review. An interrupted marker is held for inspection. */
export async function scoreDailyIdeas(workspace:string, now = new Date()) {
  const startedAt=Date.now(), day=dubaiDate(now);
  if (process.env.BLAZE_DAILY_IDEAS_ENABLED!=="true" || process.env.BLAZE_ON_DEMAND_CONTENT_ENABLED!=="true") return {paused:true};
  const authorization=await get<DailyContentGrant>(workspace,"daily_idea_authorization","default");
  const schedule=await get<IdeaSchedule>(workspace,"idea_schedule","default");
  if (!authorization || !schedule?.enabled || !Number.isFinite(Date.parse(authorization.expiresAt)) || Date.parse(authorization.expiresAt)<=now.getTime() || authorization.scheduleHash!==ideaScheduleHash(schedule)) return {paused:true};
  const consent=authorization.scoreConsent;
  if (!consent || consent.maxCostCentsPerReview!==1 || !Number.isSafeInteger(consent.maxReviewsPerDay) || consent.maxReviewsPerDay<schedule.countPerGame || consent.maxReviewsPerDay>100 || consent.countPerGame!==schedule.countPerGame) return {paused:true};
  const rows=await query<{body:IdeaBatch}>(`SELECT body FROM records WHERE workspace_id=$1 AND kind='idea_batch' AND body->>'state'='scoring' AND body->>'day'<=$2 AND NOT (body ? 'scoringIdeaId') ORDER BY body->>'createdAt',id LIMIT 1`,[workspace,day]);
  const prior=rows[0]?.body;
  if (!prior) return {paused:false,scored:0};
  if (!prior.grantHash || prior.grantHash!==hash(JSON.stringify(authorization)) || !prior.approvedBy || !prior.reviewerBinding || !authorization.scoreConsent?.reviewerBinding || !sameReviewBinding(prior.reviewerBinding,authorization.scoreConsent.reviewerBinding)) {
    await comparePut(workspace,"idea_batch",prior,{...prior,state:"needs_reconciliation",error:"The daily plan changed before these reviews. Inspect the drafts and approve a new review if needed."});
    return {paused:false,scored:0,reconciliationRequired:true};
  }
  const reviewConfig=await currentReviewBinding(workspace).catch(()=>null);
  if (!reviewConfig?.availability.enabled || !sameReviewBinding(reviewConfig,prior.reviewerBinding)) return {paused:true};
  const ideaId=prior.ideaIds?.find(i=>!prior.scoredIdeaIds?.includes(i));
  if (!ideaId || prior.ideaIds?.length!==prior.reviewReserved) return {paused:false,scored:0};
  const script=await get<ContentScript>(workspace,"content_script",`script_${hash(ideaId).slice(0,32)}`);
  if (!script || script.revision!==prior.scriptRevisions?.[ideaId]) {
    const failed:IdeaBatch={...prior,state:"needs_reconciliation",error:"A generated script is missing or changed. Inspect this batch."};
    await comparePut(workspace,"idea_batch",prior,failed); return {paused:false,scored:0,reconciliationRequired:true};
  }
  const reserved:IdeaBatch={...prior,scoringIdeaId:ideaId,scoringReservationId:randomUUID()};
  const claimed=await transaction(async sql=>{
    const currentSchedule=(await sql<{body:IdeaSchedule}>(`SELECT body FROM records WHERE workspace_id=$1 AND kind='idea_schedule' AND id='default' FOR UPDATE`,[workspace]))[0]?.body;
    if (!currentSchedule?.enabled || ideaScheduleHash(currentSchedule)!==authorization.scheduleHash) return false;
    const grant=(await sql<{body:typeof authorization}>(`SELECT body FROM records WHERE workspace_id=$1 AND kind='daily_idea_authorization' AND id='default' FOR UPDATE`,[workspace]))[0]?.body;
    if (!grant || !Number.isFinite(Date.parse(grant.expiresAt)) || Date.parse(grant.expiresAt)<=now.getTime()+Math.max(0,Date.now()-startedAt) || hash(JSON.stringify(grant))!==prior.grantHash) return false;
    const updated=(await sql(`UPDATE records SET body=$3::jsonb,updated_at=now() WHERE workspace_id=$1 AND kind='idea_batch' AND id=$2 AND body=$4::jsonb RETURNING id`,[workspace,prior.id,JSON.stringify(reserved),JSON.stringify(prior)])).length>0;
    if (!updated) return false;
    return true;
  });
  if (!claimed) return {paused:false,scored:0};
  const dispatchId=`review_${hash(JSON.stringify([prior.id,ideaId,reserved.scoringReservationId])).slice(0,32)}`;
  let admittedDay:string|undefined;
  const actualNow=()=>now.getTime()+Math.max(0,Date.now()-startedAt);
  const restoreUnstarted=async(sql:TransactionQuery)=>{
    const restored=await sql(`UPDATE records SET body=$3::jsonb,updated_at=now() WHERE workspace_id=$1 AND kind='idea_batch' AND id=$2 AND body=$4::jsonb RETURNING id`,[workspace,prior.id,JSON.stringify(prior),JSON.stringify(reserved)]);
    if(restored.length!==1)throw Error("Unstarted batch changed");
    await sql(`DELETE FROM records WHERE workspace_id=$1 AND kind='daily_review_dispatch' AND id=$2`,[workspace,dispatchId]);
  };
  // Avoid creating a short-lived review approval while quota/window is closed.
  const earlyWindow=dispatchWindow(actualNow());
  const earlyQuota=await transaction(sql=>dailyReviewCount(sql,workspace,earlyWindow.day,JSON.stringify([prior.id,ideaId])));
  if(!earlyWindow.open || earlyQuota>=consent.maxReviewsPerDay){
    await transaction(restoreUnstarted);
    return {paused:false,scored:0,...(earlyQuota>=consent.maxReviewsPerDay?{quotaReached:true}:{dispatchDeferred:true})};
  }
  try {
    await scoreGeneratedScript(workspace,prior.approvedBy,prior.id,ideaId,script,prior.reviewerBinding,{
      approvalRequestKey:reserved.scoringReservationId,
      isDispatchDeferred:error=>error instanceof DailyDispatchDeferred,
      beforeDispatch:async sql=>{
        const savedSchedule=(await sql<{body:IdeaSchedule}>(`SELECT body FROM records WHERE workspace_id=$1 AND kind='idea_schedule' AND id='default' FOR UPDATE`,[workspace]))[0]?.body;
        const grant=(await sql<{body:DailyContentGrant}>(`SELECT body FROM records WHERE workspace_id=$1 AND kind='daily_idea_authorization' AND id='default' FOR UPDATE`,[workspace]))[0]?.body;
        const at=actualNow(),window=dispatchWindow(at);
        if(!savedSchedule?.enabled || !grant || ideaScheduleHash(savedSchedule)!==authorization.scheduleHash || hash(JSON.stringify(grant))!==prior.grantHash || Date.parse(grant.expiresAt)<=at)throw Error("Daily admission changed");
        if(!window.open)throw new DailyDispatchDeferred(false);
        if(await dailyReviewCount(sql,workspace,window.day,JSON.stringify([prior.id,ideaId]))>=consent.maxReviewsPerDay)throw new DailyDispatchDeferred(true);
        const batch=(await sql(`SELECT id FROM records WHERE workspace_id=$1 AND kind='idea_batch' AND id=$2 AND body=$3::jsonb FOR UPDATE`,[workspace,prior.id,JSON.stringify(reserved)])).length;
        if(!batch)throw Error("Batch changed before dispatch");
        const dispatch={id:dispatchId,batchId:prior.id,ideaId,reservationId:reserved.scoringReservationId,day:window.day,grantHash:prior.grantHash,dispatchedAt:new Date(at).toISOString()};
        await sql(`INSERT INTO records(workspace_id,kind,id,body) VALUES($1,'daily_review_dispatch',$2,$3::jsonb)`,[workspace,dispatchId,JSON.stringify(dispatch)]);
        admittedDay=window.day;
      },
      beforeRequest:()=>{const window=dispatchWindow(actualNow());if(!window.open || window.day!==admittedDay)throw new DailyDispatchDeferred(false);},
      onDispatchAborted:restoreUnstarted,
    });
    const scoredIdeaIds=[...(prior.scoredIdeaIds||[]),ideaId];
    const next:IdeaBatch={...reserved,scoringIdeaId:undefined,scoringReservationId:undefined,scoredIdeaIds,state:scoredIdeaIds.length===prior.ideaIds!.length?"complete":"scoring"};
    await comparePut(workspace,"idea_batch",reserved,next);
    return {paused:false,scored:1};
  } catch(error) {
    if(error instanceof DailyDispatchDeferred) {
      // startScriptReview already atomically retired its known-unstarted approval
      // and restored this uniquely tokened batch/ledger. Never restore twice.
      return {paused:false,scored:0,...(error.quotaReached?{quotaReached:true}:{dispatchDeferred:true})};
    }
    const failed:IdeaBatch={...reserved,state:"needs_reconciliation",error:"A review did not complete. Inspect the draft and review receipt; it will not be retried automatically."};
    await comparePut(workspace,"idea_batch",reserved,failed);
    return {paused:false,scored:0,reconciliationRequired:true};
  }
}
