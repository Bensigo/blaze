import { z } from "zod";
import { resolveAISecret, type AISettings } from "./ai-settings";
import { reviewServiceBinding } from "./content-scripts";
import { resolveScriptReviewAdapter } from "./script-review-provider";
import { referenceContext } from "./content-references";
import { gameSources } from "./content-studio-sources";
import { ideaScheduleHash } from "./daily-content-ideas";
import { get, list, transaction } from "./db";
import { hash } from "./security";
import { HttpError } from "./http-error";
import type { IdeaSchedule } from "./content-studio-contract";
import type { Connection, Game } from "./types";

const defaults:IdeaSchedule={id:"default",countPerGame:2,localTime:"08:00",timeZone:"Asia/Dubai",maxOutputTokensPerGame:4000,enabled:false};
const gate = () => process.env.BLAZE_DAILY_IDEAS_ENABLED === "true" && process.env.BLAZE_ON_DEMAND_CONTENT_ENABLED === "true";
export async function dailyContentProposal(workspace:string) {
  const schedule=await get<IdeaSchedule>(workspace,"idea_schedule","default") || defaults;
  if (![2,3].includes(schedule.countPerGame) || !schedule.localTime || !/^([01]\d|2[0-3]):[0-5]\d$/.test(schedule.localTime) || schedule.timeZone!=="Asia/Dubai" || !Number.isInteger(schedule.maxOutputTokensPerGame) || schedule.maxOutputTokensPerGame<500 || schedule.maxOutputTokensPerGame>4000) throw new HttpError(409,"Save a valid daily schedule first.");
  const games=(await list<Game>(workspace,"game")).sort((a,b)=>a.id.localeCompare(b.id));
  if (!games.length || games.length*schedule.countPerGame>100) throw new HttpError(409,"Daily content requires 1–50 eligible games and at most 100 reviews per day.");
  const scopes=[];
  for (const game of games) {const source=await gameSources(workspace,game.id);scopes.push({gameId:game.id,title:source.title,sourceRevision:source.revision,reviewContextRevision:referenceContext(source).reviewContextRevision});}
  const secret=await resolveAISecret(workspace,false);
  if (secret.aiProvider!=="anthropic" || typeof secret.model!=="string" || typeof secret.aiConnectionId!=="string" || typeof secret.aiSettingsRevision!=="string" || typeof secret.aiCredentialVersion!=="string") throw new HttpError(409,"Select a direct Anthropic model and connection first.");
  const generationBinding={provider:"anthropic" as const,model:secret.model,connectionId:secret.aiConnectionId,settingsRevision:secret.aiSettingsRevision,credentialRevision:secret.aiCredentialVersion};
  const review=await reviewServiceBinding(workspace); const {availability:reviewAvailability,...reviewBinding}=review;
  const maxReviewsPerDay=games.length*schedule.countPerGame;
  const costDisclosure=`For 7 days, authorize one Anthropic generation request per listed game per Dubai day, up to ${schedule.maxOutputTokensPerGame} output tokens per request. Generation cost varies with provider pricing and tokenization; there is no verified monetary cap. Also authorize up to ${maxReviewsPerDay} separate OpenRouter script reviews per day, each capped at $0.01. No automatic retries.`;
  const priorGrant=await get(workspace,"daily_idea_authorization","default");
  const priorGrantRevision=hash(JSON.stringify(priorGrant||null));
  const policy={priorGrantRevision,schedule,games:scopes,generationBinding,reviewBinding,durationDays:7,maxReviewsPerDay,maxCostCentsPerReview:1,costDisclosure};
  return {...policy,proposalHash:hash(JSON.stringify(policy)),availability:!gate()?{enabled:false,reason:"Daily generation is paused pending commissioning."}:reviewAvailability};
}
export async function approveDailyContent(workspace:string,actor:string,input:{proposalHash:string;requestId:string;acknowledgeCost:true}) {
  z.object({proposalHash:z.string().min(1),requestId:z.string().uuid(),acknowledgeCost:z.literal(true)}).strict().parse(input);
  const requestId=`daily_consent_${hash(JSON.stringify([workspace,input.requestId])).slice(0,32)}`;
  const existing=await get<{id:string;actor:string;proposalHash:string;grant:DailyContentGrant}>(workspace,"daily_consent_receipt",requestId);
  if(existing){if(existing.actor!==actor||existing.proposalHash!==input.proposalHash)throw new HttpError(409,"This request ID belongs to another consent.");return existing.grant;}
  const proposal=await dailyContentProposal(workspace);
  if (!proposal.availability.enabled || !gate()) throw new HttpError(409,proposal.availability.reason||"Daily generation is paused.");
  if (proposal.proposalHash!==input.proposalHash) throw new HttpError(409,"Daily scope changed. Review the new quote.");
  const stamp=new Date(), grant:DailyContentGrant={id:"default",approvedBy:actor,approvedAt:stamp.toISOString(),expiresAt:new Date(stamp.getTime()+7*86400000).toISOString(),scheduleHash:ideaScheduleHash({...proposal.schedule,enabled:true}),gameIds:proposal.games.map(g=>g.gameId),sourceRevisions:Object.fromEntries(proposal.games.map(g=>[g.gameId,g.sourceRevision])),reviewContextRevisions:Object.fromEntries(proposal.games.map(g=>[g.gameId,g.reviewContextRevision])),aiSettingsRevision:proposal.generationBinding.settingsRevision,credentialVersion:proposal.generationBinding.credentialRevision,generationBinding:proposal.generationBinding,scoreConsent:{maxCostCentsPerReview:1,maxReviewsPerDay:proposal.maxReviewsPerDay,countPerGame:proposal.schedule.countPerGame,reviewerBinding:proposal.reviewBinding}};
  return transaction(async sql=>{
    const old=(await sql<{body:{actor:string;proposalHash:string;grant:DailyContentGrant}}>(`SELECT body FROM records WHERE workspace_id=$1 AND kind='daily_consent_receipt' AND id=$2`,[workspace,requestId]))[0]?.body;
    if(old){if(old.actor!==actor||old.proposalHash!==input.proposalHash)throw new HttpError(409,"This request ID belongs to another consent.");return old.grant;}
    await sql(`INSERT INTO records(workspace_id,kind,id,body) VALUES($1,'idea_schedule','default',$2::jsonb) ON CONFLICT DO NOTHING`,[workspace,JSON.stringify(defaults)]);
    const saved=(await sql<{body:IdeaSchedule}>(`SELECT body FROM records WHERE workspace_id=$1 AND kind='idea_schedule' AND id='default' FOR UPDATE`,[workspace]))[0]?.body || defaults;
    const raced=(await sql<{body:{actor:string;proposalHash:string;grant:DailyContentGrant}}>(`SELECT body FROM records WHERE workspace_id=$1 AND kind='daily_consent_receipt' AND id=$2`,[workspace,requestId]))[0]?.body;
    if (raced) { if (raced.actor!==actor || raced.proposalHash!==input.proposalHash) throw new HttpError(409,"This request ID belongs to another consent."); return raced.grant; }
    const previousGrant=(await sql<{body:DailyContentGrant}>("SELECT body FROM records WHERE workspace_id=$1 AND kind='daily_idea_authorization' AND id='default' FOR UPDATE",[workspace]))[0]?.body;
    if(hash(JSON.stringify(previousGrant||null))!==proposal.priorGrantRevision)throw new HttpError(409,"The daily plan changed. Review the current plan before renewing.");
    if (ideaScheduleHash(saved)!==ideaScheduleHash(proposal.schedule)) throw new HttpError(409,"Schedule changed. Review the new quote.");
    for (const scope of proposal.games) {const source=await gameSources(workspace,scope.gameId,sql);if(source.revision!==scope.sourceRevision || referenceContext(source).reviewContextRevision!==scope.reviewContextRevision)throw new HttpError(409,"Game evidence changed. Review the new quote.");}
    const settings=(await sql<{body:AISettings}>(`SELECT body FROM records WHERE workspace_id=$1 AND kind='ai_settings' AND id='default' FOR UPDATE`,[workspace]))[0]?.body;
    const conn=(await sql<{body:Connection}>(`SELECT body FROM records WHERE workspace_id=$1 AND kind='connection' AND id=$2 FOR UPDATE`,[workspace,grant.generationBinding.connectionId]))[0]?.body;
    const key=(await sql<{encrypted:string}>(`SELECT encrypted FROM credentials WHERE workspace_id=$1 AND provider=$2 FOR UPDATE`,[workspace,grant.generationBinding.connectionId]))[0]?.encrypted;
    if(!settings||!conn?.connected||!key||settings.provider!=="anthropic"||settings.model!==grant.generationBinding.model||settings.connectionId!==grant.generationBinding.connectionId||conn.provider!=="anthropic"||conn.model!==settings.model||(settings.revision||`legacy-${hash(JSON.stringify(settings))}`)!==grant.aiSettingsRevision||(conn.credentialVersion||`legacy-${hash(key)}`)!==grant.credentialVersion)throw new HttpError(409,"Generation connection changed. Review the new quote.");
    const reviewSettings=(await sql<{body:{connectionId:string;model:string;revision:string;credentialVersion:string;reviewAdapter?:unknown}}>(`SELECT body FROM records WHERE workspace_id=$1 AND kind='jev_settings' AND id='default' FOR UPDATE`,[workspace]))[0]?.body;
    const reviewConn=(await sql<{body:Connection}>(`SELECT body FROM records WHERE workspace_id=$1 AND kind='connection' AND id=$2 FOR UPDATE`,[workspace,proposal.reviewBinding.connectionId]))[0]?.body;
    const reviewKey=(await sql<{encrypted:string}>(`SELECT encrypted FROM credentials WHERE workspace_id=$1 AND provider=$2 FOR UPDATE`,[workspace,proposal.reviewBinding.connectionId]))[0]?.encrypted;
    const adapter=reviewSettings && resolveScriptReviewAdapter(reviewSettings.reviewAdapter);
    if(!reviewSettings||!reviewConn?.connected||reviewConn.provider!=="openrouter"||!reviewKey||reviewSettings.connectionId!==proposal.reviewBinding.connectionId||reviewSettings.model!==proposal.reviewBinding.model||reviewSettings.revision!==proposal.reviewBinding.settingsRevision||reviewSettings.credentialVersion!==proposal.reviewBinding.credentialRevision||`${reviewConn.credentialVersion||"legacy"}:${hash(reviewKey)}`!==proposal.reviewBinding.credentialRevision||adapter?.id!==proposal.reviewBinding.adapterId||adapter?.revision!==proposal.reviewBinding.adapterRevision)throw new HttpError(409,"Review connection changed. Review the new quote.");
    await sql(`INSERT INTO records(workspace_id,kind,id,body) VALUES($1,'idea_schedule','default',$2::jsonb) ON CONFLICT(workspace_id,kind,id) DO UPDATE SET body=excluded.body,updated_at=now()`,[workspace,JSON.stringify({...proposal.schedule,enabled:true})]);
    await sql(`INSERT INTO records(workspace_id,kind,id,body) VALUES($1,'daily_idea_authorization','default',$2::jsonb) ON CONFLICT(workspace_id,kind,id) DO UPDATE SET body=excluded.body,updated_at=now()`,[workspace,JSON.stringify(grant)]);
    await sql(`INSERT INTO records(workspace_id,kind,id,body) VALUES($1,'daily_consent_receipt',$2,$3::jsonb)`,[workspace,requestId,JSON.stringify({id:requestId,actor,proposalHash:input.proposalHash,grant})]);
    return grant;
  });
}
export type DailyContentGrant={id:"default";approvedBy:string;approvedAt:string;expiresAt:string;scheduleHash:string;gameIds:string[];sourceRevisions:Record<string,string>;reviewContextRevisions:Record<string,string>;aiSettingsRevision:string;credentialVersion:string;generationBinding:{provider:"anthropic";model:string;connectionId:string;settingsRevision:string;credentialRevision:string};scoreConsent:{maxCostCentsPerReview:1;maxReviewsPerDay:number;countPerGame:2|3;reviewerBinding:{connectionId:string;model:string;settingsRevision:string;credentialRevision:string;adapterId:string;adapterRevision:string}}};
