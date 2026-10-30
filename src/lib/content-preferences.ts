import { get, list, transaction } from "./db";
import { HttpError } from "./http-error";
import type { ContentIdea } from "./content-studio-contract";
export type ContentRejection = {id:string;ideaId:string;gameId:string;sourceRevision:string;title:string;treatment:string;reason?:string;rejectedAt:string;actor:string};
/** A preference record, not deletion or a claim of model training. */
export async function rejectContentIdea(workspace:string,actor:string,ideaId:string,reason?:string){
 const idea=await get<ContentIdea>(workspace,"content_idea",ideaId);if(!idea)throw new HttpError(404,"Idea not found.");
 const rejection:ContentRejection={id:ideaId,ideaId,gameId:idea.gameId,sourceRevision:idea.sourceRevision,title:idea.title,treatment:idea.treatment,reason:reason?.trim()||undefined,rejectedAt:new Date().toISOString(),actor};
 return transaction(async sql=>{
  await sql("SELECT id FROM records WHERE workspace_id=$1 AND kind='content_script' AND body->>'ideaId'=$2 FOR UPDATE",[workspace,ideaId]);
  await sql("SELECT id FROM records WHERE workspace_id=$1 AND kind='content_idea' AND id=$2 FOR UPDATE",[workspace,ideaId]);
  const prior=(await sql<{body:ContentRejection}>("SELECT body FROM records WHERE workspace_id=$1 AND kind='content_rejection' AND id=$2",[workspace,ideaId]))[0]?.body;if(prior)return prior;
  await sql("INSERT INTO records(workspace_id,kind,id,body) VALUES($1,'content_rejection',$2,$3::jsonb)",[workspace,ideaId,JSON.stringify(rejection)]);
  await sql(`UPDATE records SET body=body || '{"state":"failed","error":"This suggestion was rejected before execution. No request was started."}'::jsonb,updated_at=now() WHERE workspace_id=$1 AND kind='video_production' AND body->>'ideaId'=$2 AND body->>'state'='approved'`,[workspace,ideaId]);
  await sql(`UPDATE records SET body=body || '{"state":"failed","error":"This suggestion was rejected before review. No request was started."}'::jsonb,updated_at=now() WHERE workspace_id=$1 AND kind='script_review' AND body->>'scriptId' IN (SELECT id FROM records WHERE workspace_id=$1 AND kind='content_script' AND body->>'ideaId'=$2) AND body->>'state'='approved'`,[workspace,ideaId]);
  return rejection;
 });
}
export async function contentRejections(workspace:string,gameId?:string){return (await list<ContentRejection>(workspace,"content_rejection")).filter(r=>!gameId||r.gameId===gameId).sort((a,b)=>b.rejectedAt.localeCompare(a.rejectedAt));}
