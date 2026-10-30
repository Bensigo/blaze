import {referenceContext, referenceStructure} from "./content-references";
import { z } from "zod";
import { get, list, query, transaction, type TransactionQuery } from "./db";
import { hash } from "./security";
import { HttpError } from "./http-error";
import { secretFor } from "./credentials";
import { gameSources } from "./content-studio-sources";
import type { ContentIdea } from "./content-studio-contract";
export type ReviewContextBinding = {referenceSetId?:string;referenceSetRevision?:string;referenceIds?:string[];rubricRevision?:string;reviewContextRevision?:string};
export type ContentScript = ReviewContextBinding & { id: string; gameId: string; ideaId: string; sourceRevision: string; text: string; revision: string; updatedAt: string; origin: "source_draft" | "owner" | "generated" };
export { scriptScoreSchema, decisionsScoreSchema, scoreFromDecisions } from "./script-review-provider";
import { scriptScoreSchema, resolveScriptReviewAdapter, DEFAULT_SCRIPT_REVIEW_ADAPTER } from "./script-review-provider";
import type { ScriptScore } from "./script-review-provider";
export type { ScriptScore } from "./script-review-provider";
export type ScriptReview = ReviewContextBinding & { adapterId?: string; adapterRevision?: string; maxCostCents: 1; costPolicyRevision: string; maxBillableInputTokens: number; maxCostBoundNanoUsd: number; costAdmissionViolation?: boolean; id: string; scriptId: string; scriptRevision: string; scriptText: string; sourceRevision: string; gameId: string; state: "approved" | "starting" | "complete" | "failed" | "needs_reconciliation"; approvedBy: string; approvedAt: string; expiresAt: string; reviewHash: string; connectionId: string; model: string; settingsRevision: string; credentialRevision: string; score?: ScriptScore; error?: string; usage?: { inputTokens?: number; outputTokens?: number; reportedCostUsd?: number }; updatedAt: string };
const scriptId = (ideaId: string) => `script_${hash(ideaId).slice(0,32)}`;
export async function saveContentScript(workspace: string, ideaId: string, text?: string, expectedRevision?: string, origin: "owner" | "generated" = "owner") {
  return transaction(async sql => {
    const idea = (await sql<{ body: ContentIdea }>(`SELECT body FROM records WHERE workspace_id=$1 AND kind='content_idea' AND id=$2`, [workspace, ideaId]))[0]?.body;
    if (!idea) throw new HttpError(404, "Idea not found.");
    const source = await gameSources(workspace, idea.gameId, sql);
    if (source.revision !== idea.sourceRevision) throw new HttpError(409, "Game evidence changed; prepare a fresh idea.");
    const prior = (await sql<{ body: ContentScript }>(`SELECT body FROM records WHERE workspace_id=$1 AND kind='content_script' AND id=$2 FOR UPDATE`, [workspace, scriptId(ideaId)]))[0]?.body;
    if (text === undefined && prior) return prior;
    if (prior && prior.revision !== expectedRevision) throw new HttpError(409, "Script changed in another tab. Reload before editing.");
    const context = referenceContext(source);
    const draft = text ?? `${idea.hook}\n\n${idea.shots.map((shot,i) => `${i+1}. ${shot}`).join("\n")}\n\nCaption facts to demonstrate: ${source.facts.slice(0,3).map(f=>f.value.slice(0,400)).join(" ")}\n\nShow only the observed outcome. End on the game title.\n\nStructure guidance: ${referenceStructure}`;
    const clean = z.string().trim().min(20).max(5000).parse(draft);
    const revision = hash(JSON.stringify({ ideaId, sourceRevision: source.revision, text: clean, reviewContextRevision:context.reviewContextRevision }));
    const script: ContentScript = { id: scriptId(ideaId), gameId: idea.gameId, ideaId, sourceRevision: source.revision, text: clean, revision, updatedAt: new Date().toISOString(), origin: text === undefined ? "source_draft" : origin,referenceSetId:context.referenceSetId,referenceSetRevision:context.referenceSetRevision,referenceIds:context.referenceIds,rubricRevision:context.rubricRevision,reviewContextRevision:context.reviewContextRevision };
    await sql(`INSERT INTO records(workspace_id,kind,id,body) VALUES($1,'content_script',$2,$3::jsonb) ON CONFLICT(workspace_id,kind,id) DO UPDATE SET body=excluded.body,updated_at=now()`, [workspace, script.id, JSON.stringify(script)]);
    // Old critique is retained as stale history. Unstarted production cannot use it.
    await sql(`UPDATE records SET body=body || '{"state":"failed","error":"Script changed. Obtain a new script review and approve the new version."}'::jsonb,updated_at=now() WHERE workspace_id=$1 AND kind='video_production' AND body->>'ideaId'=$2 AND body->>'state'='approved' AND (body->>'scriptRevision') IS DISTINCT FROM $3`, [workspace, ideaId, revision]);
    await sql(`UPDATE records SET body=body || '{"state":"failed","error":"Unstarted script review approval consumed because the script changed."}'::jsonb,updated_at=now() WHERE workspace_id=$1 AND kind='script_review' AND body->>'scriptId'=$2 AND body->>'state'='approved' AND body->>'scriptRevision'<>$3`, [workspace, script.id, revision]);
    return script;
  });
}
export async function scriptState(workspace: string, ideaId: string) {
  const script = await get<ContentScript>(workspace, "content_script", scriptId(ideaId));
  const reviews = (await list<ScriptReview>(workspace, "script_review")).filter(r=>r.scriptId===scriptId(ideaId)).sort((a,b)=>b.approvedAt.localeCompare(a.approvedAt)||b.id.localeCompare(a.id));
  const source = script ? await gameSources(workspace, script.gameId).catch(() => null) : null;
  const sourceStale = !!script && source?.revision !== script.sourceRevision;
  const context = source ? referenceContext(source) : null;
  const contextStale = !!script && script.reviewContextRevision !== context?.reviewContextRevision;
  const review = reviews.find(r=>r.scriptRevision===script?.revision&&r.reviewContextRevision===context?.reviewContextRevision);
  return {script,sourceStale,contextStale,context:context?{referenceSetRevision:context.referenceSetRevision,rubricRevision:context.rubricRevision,referenceIds:context.referenceIds}:null,
    review:sourceStale||contextStale?undefined:review,
    staleReview:reviews.find(r=>!!r.score&&(sourceStale||contextStale||r.scriptRevision!==script?.revision||r.reviewContextRevision!==context?.reviewContextRevision)),
    caveat:"The review score is not a predicted probability of virality. Each category is scored out of25; overall is their sum out of100."};
}
export async function reviewedScript(workspace: string, ideaId: string, sourceRevision: string, sql?: TransactionQuery) {
  const script = sql ? (await sql<{ body: ContentScript }>(`SELECT body FROM records WHERE workspace_id=$1 AND kind='content_script' AND id=$2 FOR UPDATE`, [workspace, scriptId(ideaId)]))[0]?.body : await get<ContentScript>(workspace,"content_script",scriptId(ideaId));
  if (!script || script.sourceRevision !== sourceRevision) throw new HttpError(409,"Draft or edit this script and obtain its script review before approving video production.");
  const currentContext=referenceContext(await gameSources(workspace,script.gameId,sql));
  if(script.reviewContextRevision!==currentContext.reviewContextRevision)throw new HttpError(409,"Script references or rubric changed. Save with current references and obtain a fresh script review score.");
  const rows = await (sql || query)<{ body: ScriptReview }>(`SELECT body FROM records WHERE workspace_id=$1 AND kind='script_review' AND body->>'scriptId'=$2 AND body->>'scriptRevision'=$3 AND body->>'sourceRevision'=$4 ORDER BY body->>'approvedAt' DESC,id DESC LIMIT 1`, [workspace,script.id,script.revision,sourceRevision]);
  const review = rows[0]?.body;
  if (review?.state !== "complete" || !review.score || review.reviewContextRevision!==currentContext.reviewContextRevision) throw new HttpError(409,"A successful script review score for this exact script revision is required.");
  scriptScoreSchema.parse(review.score);
  return { script, review };
}
export async function scriptReviewAvailability(workspace: string) {
  if(process.env.BLAZE_JEV_SCRIPT_REVIEW_ENABLED!=="true") return {enabled:false,reason:"Script reviews are paused pending one-time service commissioning. No new review request has been sent."};
  const held = (await query(`SELECT id FROM records WHERE workspace_id=$1 AND kind='script_review' AND (body->>'costAdmissionViolation'='true' OR body->>'state' IN ('starting','needs_reconciliation')) LIMIT 1`,[workspace])).length > 0;
  return held ? {enabled:false,reason:"An earlier script review request is active, uncertain or exceeded its cost bound. Reconcile billing for that request before another review."} : {enabled:true};
}
const reviewEnabled = async (workspace: string) => {
  const availability = await scriptReviewAvailability(workspace);
  if (!availability.enabled) throw new HttpError(409, availability.reason!);
};
async function jevSelection(workspace:string) {
  const secret=await secretFor(workspace,"jev");
  if(!secret?.token || !secret.model || !secret.jevConnectionId || !secret.jevSettingsRevision || !secret.jevCredentialVersion)throw new HttpError(409,"Select the existing Jev OpenRouter connection before reviewing a script.");
  return {secret, binding:{connectionId:String(secret.jevConnectionId),model:secret.model,settingsRevision:String(secret.jevSettingsRevision),credentialRevision:String(secret.jevCredentialVersion)}};
}
/** Read-only service identity for authorizing future reviews; never exposes the token. */
export async function reviewServiceBinding(workspace:string) {
  const {binding}=await jevSelection(workspace);
  const settings=await get<{ reviewAdapter?: unknown }>(workspace,"jev_settings","default");
  const adapter=resolveScriptReviewAdapter(settings?.reviewAdapter);
  return {...binding,adapterId:adapter.id,adapterRevision:adapter.revision,availability:await scriptReviewAvailability(workspace)};
}
export async function reviewScriptProposal(workspace:string,script:string) {
  const current=await get<ContentScript>(workspace,"content_script",script); if(!current)throw new HttpError(404,"Script not found.");
  const source=await gameSources(workspace,current.gameId); if(source.revision!==current.sourceRevision)throw new HttpError(409,"Script source changed.");
  const context=referenceContext(source);if(current.reviewContextRevision!==context.reviewContextRevision)throw new HttpError(409,"References or rubric changed. Save the script with current references before requesting a new review.");
  const {binding}=await jevSelection(workspace);
  const settings=await get<{ reviewAdapter?: unknown }>(workspace,"jev_settings","default");
  const adapter=resolveScriptReviewAdapter(settings?.reviewAdapter);
  const admitted=adapter.admit(adapter.buildRequest(binding.model,current,source.facts.map(f=>f.value),context.referenceSummaries));
  const {request,body:prompt,admission:costAdmission}=admitted;
  const adapterBinding={adapterId:adapter.id,adapterRevision:adapter.revision};
  const legacyReviewHash=hash(JSON.stringify({current,binding,request,pricing:adapter.pricing,costAdmission}));
  return {script:current,binding,adapterBinding,adapter,request,prompt,costAdmission,pricing:adapter.pricing,legacyReviewHash,
    reviewHash:hash(JSON.stringify({current,binding,request,pricing:adapter.pricing,costAdmission,adapterBinding})),
    questionCount:costAdmission.questionCount,inputBytes:costAdmission.inputBytes};
}
export async function approveScriptReview(workspace:string,actor:string,input:{scriptId:string;reviewHash:string;requestId:string;maxCostCents:1}) {
  z.literal(1).parse(input.maxCostCents);z.string().uuid().parse(input.requestId);
  const receipt=await get<ScriptReview>(workspace,"script_review",`critique_${hash(`${workspace}:${input.requestId}`).slice(0,32)}`);
  if(receipt){if(receipt.approvedBy!==actor||receipt.scriptId!==input.scriptId||receipt.reviewHash!==input.reviewHash)throw new HttpError(409,"This request approved a different script review.");return receipt;}
  await reviewEnabled(workspace);const proposal=await reviewScriptProposal(workspace,input.scriptId);
  if(input.reviewHash!==proposal.reviewHash)throw new HttpError(409,"Script or Review selection changed; review the request again.");
  const id=`critique_${hash(`${workspace}:${input.requestId}`).slice(0,32)}`; const stamp=new Date().toISOString();
  return transaction(async sql=>{
    const source=await gameSources(workspace,proposal.script.gameId,sql);
    if(source.revision!==proposal.script.sourceRevision)throw new HttpError(409,"Game source changed before script review approval.");
    const script=(await sql<{body:ContentScript}>(`SELECT body FROM records WHERE workspace_id=$1 AND kind='content_script' AND id=$2 FOR UPDATE`,[workspace,input.scriptId]))[0]?.body;
    if(!script || script.revision!==proposal.script.revision)throw new HttpError(409,"Script changed before review approval.");
    if((await sql(`SELECT id FROM records WHERE workspace_id=$1 AND kind='content_rejection' AND id=$2`,[workspace,script.ideaId])).length)throw new HttpError(409,"This suggestion was rejected; it cannot be reviewed.");
    const old=(await sql<{body:ScriptReview}>(`SELECT body FROM records WHERE workspace_id=$1 AND kind='script_review' AND id=$2`,[workspace,id]))[0]?.body;
    if(old){if(old.reviewHash!==input.reviewHash)throw new HttpError(409,"This request approved a different script review.");return old;}
    await sql(`UPDATE records SET body=body || '{"state":"failed","error":"Unstarted script review approval expired or became stale; obtain fresh explicit approval."}'::jsonb,updated_at=now() WHERE workspace_id=$1 AND kind='script_review' AND body->>'scriptId'=$2 AND body->>'state'='approved' AND ((body->>'expiresAt')::timestamptz<=now() OR body->>'scriptRevision'<>$3 OR body->>'sourceRevision'<>$4)`,[workspace,script.id,script.revision,script.sourceRevision]);
    const active=await sql(`SELECT id FROM records WHERE workspace_id=$1 AND kind='script_review' AND body->>'scriptId'=$2 AND body->>'state' IN ('approved','starting','needs_reconciliation') LIMIT 1`,[workspace,input.scriptId]);
    if(active.length)throw new HttpError(409,"This script already has an approved or uncertain script review. Inspect it before another attempt.");
    const review:ScriptReview={maxCostCents:1,costPolicyRevision:proposal.costAdmission.policyRevision,maxBillableInputTokens:proposal.costAdmission.maxBillableInputTokens,maxCostBoundNanoUsd:proposal.costAdmission.maxCostBoundNanoUsd,id,referenceSetId:script.referenceSetId,referenceSetRevision:script.referenceSetRevision,referenceIds:script.referenceIds,rubricRevision:script.rubricRevision,reviewContextRevision:script.reviewContextRevision,scriptId:script.id,scriptRevision:script.revision,scriptText:script.text,sourceRevision:script.sourceRevision,gameId:script.gameId,state:"approved",approvedBy:actor,approvedAt:stamp,updatedAt:stamp,expiresAt:new Date(Date.now()+15*60000).toISOString(),reviewHash:input.reviewHash,...proposal.binding,...proposal.adapterBinding};
    await sql(`INSERT INTO records(workspace_id,kind,id,body) VALUES($1,'script_review',$2,$3::jsonb)`,[workspace,id,JSON.stringify(review)]);
    await sql(`UPDATE records SET body=body || '{"state":"failed","error":"A new script review was approved; approve video production again after its result."}'::jsonb,updated_at=now() WHERE workspace_id=$1 AND kind='video_production' AND body->>'scriptId'=$2 AND body->>'state'='approved'`,[workspace,script.id]);
    return review;
  });
}
export async function startScriptReview(workspace:string,id:string,options?:{timeoutMs?:number}) {
  const prior=await get<ScriptReview>(workspace,"script_review",id);if(!prior)throw new HttpError(404,"Script review not found.");if(prior.state!=="approved")return prior;await reviewEnabled(workspace);
  const saved=await get<ContentScript>(workspace,"content_script",prior.scriptId);
  const context=saved?referenceContext(await gameSources(workspace,saved.gameId)):null;
  if(!context || prior.reviewContextRevision!==context.reviewContextRevision || saved?.reviewContextRevision!==context.reviewContextRevision){
    await query(`UPDATE records SET body=body || '{"state":"failed","error":"Reference or rubric version changed. This unstarted approval is invalid; obtain a fresh review approval."}'::jsonb,updated_at=now() WHERE workspace_id=$1 AND kind='script_review' AND id=$2 AND body->>'state'='approved'`,[workspace,id]);return get<ScriptReview>(workspace,"script_review",id);
  }
  const proposal=await reviewScriptProposal(workspace,prior.scriptId);
  if(Date.parse(prior.expiresAt)<=Date.now() || (prior.adapterId !== undefined || prior.adapterRevision !== undefined ? proposal.reviewHash!==prior.reviewHash || prior.adapterId!==proposal.adapterBinding.adapterId || prior.adapterRevision!==proposal.adapterBinding.adapterRevision : proposal.adapter.id!==DEFAULT_SCRIPT_REVIEW_ADAPTER || proposal.legacyReviewHash!==prior.reviewHash) || prior.maxCostCents!==1 || prior.costPolicyRevision!==proposal.costAdmission.policyRevision || prior.maxBillableInputTokens!==proposal.costAdmission.maxBillableInputTokens || prior.maxCostBoundNanoUsd!==proposal.costAdmission.maxCostBoundNanoUsd){
    await query(`UPDATE records SET body=body || '{"state":"failed","error":"script review approval expired or changed. No request was sent; fresh approval is required."}'::jsonb,updated_at=now() WHERE workspace_id=$1 AND kind='script_review' AND id=$2 AND body->>'state'='approved'`,[workspace,id]);
    return get<ScriptReview>(workspace,"script_review",id);
  }
  const {secret,binding}=await jevSelection(workspace);
  if(JSON.stringify(binding)!==JSON.stringify(proposal.binding))throw new HttpError(409,"Review selection changed before dispatch.");
  const headers={Authorization:`Bearer ${secret.token}`,"Content-Type":"application/json"};
  const admitted=proposal.adapter.admit(proposal.request,headers);
  if(admitted.body!==proposal.prompt)throw new HttpError(409,"Review payload changed after cost admission.");
  const reserved=await transaction(async sql=>{
    const source=await gameSources(workspace,prior.gameId,sql);
    const script=(await sql<{body:ContentScript}>(`SELECT body FROM records WHERE workspace_id=$1 AND kind='content_script' AND id=$2 FOR UPDATE`,[workspace,prior.scriptId]))[0]?.body;
    if(source.revision!==prior.sourceRevision || script?.revision!==prior.scriptRevision)throw new HttpError(409,"Script or source changed before review dispatch.");
    if((await sql(`SELECT id FROM records WHERE workspace_id=$1 AND kind='content_rejection' AND id=$2`,[workspace,script.ideaId])).length)throw new HttpError(409,"This suggestion was rejected; its review cannot start.");
    const selection=(await sql<{body:{connectionId:string;model:string;revision:string;credentialVersion:string;reviewAdapter?:unknown}}>(`SELECT body FROM records WHERE workspace_id=$1 AND kind='jev_settings' AND id='default' FOR UPDATE`,[workspace]))[0]?.body;
    const connection=(await sql<{body:{provider:string;connected:boolean;credentialVersion?:string}}>(`SELECT body FROM records WHERE workspace_id=$1 AND kind='connection' AND id=$2 FOR UPDATE`,[workspace,prior.connectionId]))[0]?.body;
    // All Jev starts share this settings-row lock. Recheck workspace holds here,
    // not only before the transaction, so two approved scripts cannot both pass
    // preflight and dispatch while the first request is still unresolved.
    if((await sql(`SELECT id FROM records WHERE workspace_id=$1 AND kind='script_review' AND id<>$2 AND (body->>'costAdmissionViolation'='true' OR body->>'state' IN ('starting','needs_reconciliation')) LIMIT 1`,[workspace,id])).length)throw new HttpError(409,"An earlier script review request is active or uncertain. Reconcile billing before another review.");
    const key=(await sql<{encrypted:string}>(`SELECT encrypted FROM credentials WHERE workspace_id=$1 AND provider=$2 FOR UPDATE`,[workspace,prior.connectionId]))[0]?.encrypted;
    if(!selection || resolveScriptReviewAdapter(selection.reviewAdapter).id!==proposal.adapter.id || selection.connectionId!==prior.connectionId || selection.model!==prior.model || selection.revision!==prior.settingsRevision || selection.credentialVersion!==prior.credentialRevision || !connection?.connected || connection.provider!=="openrouter" || !key || `${connection.credentialVersion||"legacy"}:${hash(key)}`!==prior.credentialRevision) throw new HttpError(409,"Review service connection changed before dispatch.");
    if (!Number.isFinite(Date.parse(prior.expiresAt)) || Date.parse(prior.expiresAt)<=Date.now()) throw new HttpError(409,"The review approval expired before dispatch. No request was sent.");
    return (await sql(`UPDATE records SET body=body || '{"state":"starting"}'::jsonb,updated_at=now() WHERE workspace_id=$1 AND kind='script_review' AND id=$2 AND body=$3::jsonb RETURNING id`,[workspace,id,JSON.stringify(prior)])).length>0;
  });
  if(!reserved)return get<ScriptReview>(workspace,"script_review",id);
  let next:ScriptReview; let responseReceived=false; let costAdmissionViolation=true; let usage:ScriptReview["usage"];
  try {
    const timeoutMs = Number.isFinite(options?.timeoutMs) ? Math.max(1, Math.min(45000, Math.floor(options!.timeoutMs!))) : 45000;
    const response=await fetch(proposal.adapter.endpoint,{method:"POST",redirect:"error",signal:AbortSignal.timeout(timeoutMs),headers,body:admitted.body});
    if(!response.ok){await response.body?.cancel();throw new Error("Provider request failed.");}
    const reader=response.body?.getReader();if(!reader)throw new Error("Empty provider response.");let size=0;const chunks:Uint8Array[]=[];
    for(;;){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>128*1024){await reader.cancel();throw new Error("Response too large.");}chunks.push(part.value);}
    responseReceived=true;
    const raw=JSON.parse(Buffer.concat(chunks,size).toString("utf8"));
    const billing=proposal.adapter.verifyBilling(raw,String(secret.model),proposal.costAdmission);
    const {valid, ...reportedUsage}=billing; usage=reportedUsage;
    if(!valid){costAdmissionViolation=true;throw new Error("Documented cost admission could not be verified.");}
    costAdmissionViolation=false;
    const result=proposal.adapter.parse(raw,String(secret.model));
    const {score}=result; usage=result.usage;
    next={...prior,state:"complete",score,updatedAt:new Date().toISOString(),usage};
  }catch{next={...prior,state:costAdmissionViolation?"needs_reconciliation":responseReceived?"failed":"needs_reconciliation",usage,...(costAdmissionViolation?{costAdmissionViolation:true}:{}),updatedAt:new Date().toISOString(),error:costAdmissionViolation?"Provider usage could not be verified against the documented one-cent admission bound. No score accepted; all further script reviews are blocked pending billing reconciliation.":"script review failed or its result is uncertain. No score is available and this approval will never be retried. Inspect OpenRouter before approving a new request."};}
  await query(`UPDATE records SET body=$3::jsonb,updated_at=now() WHERE workspace_id=$1 AND kind='script_review' AND id=$2 AND body->>'state'='starting'`,[workspace,id,JSON.stringify(next)]);
  return get<ScriptReview>(workspace,"script_review",id);
}
