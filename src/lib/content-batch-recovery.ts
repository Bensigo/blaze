import {comparePut,get} from "./db";
import {reviewedScript,type ContentScript} from "./content-scripts";
import {hash} from "./security";
type Batch={id:string;state:string;ideaIds?:string[];scriptRevisions?:Record<string,string>;scoredIdeaIds?:string[];scoringIdeaId?:string;updatedAt?:string;error?:string};
/** Reconcile already stored scores only. Never calls a model or repeats a request. */
export async function reconcileContentBatch(workspace:string,kind:"on_demand_content"|"idea_batch",id:string){
 const batch=await get<Batch>(workspace,kind,id);if(!batch||!["scoring","needs_reconciliation"].includes(batch.state)||!batch.ideaIds?.length||!batch.scriptRevisions)return batch;
 const completed:string[]=[];
 for(const ideaId of batch.ideaIds){
  const script=await get<ContentScript>(workspace,"content_script",`script_${hash(ideaId).slice(0,32)}`);
  if(!script||script.revision!==batch.scriptRevisions[ideaId])continue;
  try{const current=await reviewedScript(workspace,ideaId,script.sourceRevision);if(current.review.score&&current.script.revision===script.revision)completed.push(ideaId);}catch{/* Missing, stale or uncertain results remain held. */}
 }
 const all=completed.length===batch.ideaIds.length;const markerCompleted=!!batch.scoringIdeaId&&completed.includes(batch.scoringIdeaId);
 if(!all&&!(batch.state==="scoring"&&markerCompleted))return batch;
 const next={...batch,state:all?"complete":"scoring",scoringIdeaId:undefined,scoredIdeaIds:completed,error:undefined,...(batch.updatedAt?{updatedAt:new Date().toISOString()}: {})};
 await comparePut(workspace,kind,batch,next);return get<Batch>(workspace,kind,id);
}
