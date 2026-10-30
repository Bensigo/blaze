import {reconcileContentBatch} from "./content-batch-recovery";
import {query} from "./db";
import {tickContentProduction} from "./content-production-worker";
import {scoreOnDemand,type OnDemandReceipt} from "./on-demand-content";
import {runDailyIdeas,scoreDailyIdeas} from "./daily-content-ideas";
/** One native invocation, one paid stage at most. Saved grants alone authorize it. */
export async function tickContentService(workspace:string,now=new Date()){
 if(process.env.BLAZE_CLOUD_WATCHDOG_SCHEDULE_ENABLED!=="true")return{paused:true};
 const started=Date.now();const production=await tickContentProduction(workspace,now.getTime());
 const watch=production.watchdog;
 if(("healthy" in watch&&!watch.healthy)||("busy" in watch&&watch.busy)||Date.now()-started>3000)return{production};
 const recovery=await query<{kind:"on_demand_content"|"idea_batch";id:string}>("SELECT kind,id FROM records WHERE workspace_id=$1 AND kind IN ('on_demand_content','idea_batch') AND body->>'state' IN ('scoring','needs_reconciliation') AND (body ? 'scoringIdeaId') ORDER BY updated_at,id LIMIT 1",[workspace]);
 if(recovery[0])await reconcileContentBatch(workspace,recovery[0].kind,recovery[0].id);
 // A killed function cannot leave a paid stage looking busy forever. These
 // markers are never dispatched again; only explicit reconciliation is offered.
 await query(`UPDATE records SET body=body || '{"state":"needs_reconciliation","error":"A generation or scoring stage was interrupted. Inspect its saved drafts and provider receipt; no automatic retry was made."}'::jsonb,updated_at=now() WHERE workspace_id=$1 AND kind IN ('on_demand_content','idea_batch') AND (body->>'state'='starting' OR (body->>'state'='scoring' AND body ? 'scoringIdeaId')) AND updated_at<now()-interval '120 seconds'`,[workspace]);
 if(Date.now()-started>3000)return{production};
 const pending=(await query<{body:OnDemandReceipt}>(`SELECT body FROM records WHERE workspace_id=$1 AND kind='on_demand_content' AND body->>'state'='scoring' AND NOT (body ? 'scoringIdeaId') ORDER BY body->>'approvedAt',id LIMIT 1`,[workspace]))[0]?.body;
 if(pending)return{production,content:await scoreOnDemand(workspace,pending.id)};
 const day=new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Dubai",year:"numeric",month:"2-digit",day:"2-digit"}).format(now);
 const scoring=(await query("SELECT id FROM records WHERE workspace_id=$1 AND kind='idea_batch' AND body->>'state'='scoring' AND body->>'day'=$2 AND NOT (body ? 'scoringIdeaId') LIMIT 1",[workspace,day])).length>0;
 if(scoring)return{production,daily:await scoreDailyIdeas(workspace,now)};
 if(Date.now()-started>3000)return{production};
 return{production,daily:await runDailyIdeas(workspace,now)};
}
