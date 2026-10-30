import {z} from 'zod';
import data from '@/data/content-references-v2.json';
import {hash} from './security';
import {approvalJson} from './approval-json';
import {SCRIPT_RUBRIC, SCRIPT_RUBRIC_REVISION} from './script-review-rubric';
const recordSchema=z.object({
 id:z.string().regex(/^(ai|game)\d{2}$/),title:z.string().min(1),url:z.string().url().refine(u=>/^https:\/\/x\.com\/[A-Za-z0-9_]+\/status\/\d+$/.test(u)),
 creator:z.string(),lane:z.enum(['ai_video','gameplay_promotion']),ai_status:z.enum(['creator_disclosed','secondary_reported_exact_model_unverified','unknown']),
 caption_excerpt:z.string().max(500),frames:z.array(z.string().max(500)).min(1).max(4),inspection:z.string(),observed_at:z.iso.date().or(z.iso.datetime({offset:true})),
 post_datetime_utc_derived:z.string().nullable(),date_visible:z.string().nullable(),duration_seconds:z.number().positive().nullable(),pacing:z.null(),payoff:z.string().nullable(),cta:z.string().nullable(),
 comparison_role:z.enum(['higher_reach_reference','lower_reach_comparator']),
 metrics:z.object({post_views:z.number().int().nonnegative(),likes:z.number().int().nonnegative(),reposts:z.number().int().nonnegative(),replies:z.number().int().nonnegative(),bookmarks:z.number().int().nonnegative(),video_plays:z.null(),unique_viewers:z.null()}),
 evidence_level:z.enum(['direct_X_caption_metrics_and_sampled_video_frame','direct_X_caption_metrics_and_sampled_video_frames']),calibration_eligible:z.literal(false),
 prompt_eligibility:z.object({caption:z.literal(true),sampled_visual_summary:z.literal(true),creator_workflow_summary:z.boolean(),complete_video_script:z.literal(false),measured_pacing:z.literal(false),viral_prediction_training:z.literal(false)}),
 creator_workflow_summary:z.string().nullable(),ai_disclosure:z.string().nullable(),claim_warning:z.string().nullable(),
}).passthrough();
export type ContentReference=z.infer<typeof recordSchema>;
export const referenceLibrarySchema=z.object({schema_version:z.literal('2.0'),set_id:z.string(),status:z.literal('observed_reference_library_not_validated_benchmark'),metric_note:z.string(),limitations:z.array(z.string()),records:z.array(recordSchema).length(24)}).passthrough().superRefine((d,c)=>{
 if(new Set(d.records.map(r=>r.id)).size!==24||new Set(d.records.map(r=>r.url)).size!==24)c.addIssue({code:'custom',message:'References require24 unique IDs and canonical URLs.'});
 for(const prefix of ['ai','game'])for(let i=1;i<=(prefix==='ai'?14:10);i++)if(!d.records.some(r=>r.id===`${prefix}${String(i).padStart(2,'0')}`))c.addIssue({code:'custom',message:'Missing required reference ID.'});
 const ai=d.records.filter(r=>r.lane==='ai_video'),game=d.records.filter(r=>r.lane==='gameplay_promotion');
 if(ai.length!==14||game.length!==10||ai.filter(r=>r.ai_status==='creator_disclosed').length!==13||ai.filter(r=>r.comparison_role==='lower_reach_comparator').length!==2||game.filter(r=>r.comparison_role==='lower_reach_comparator').length!==2)c.addIssue({code:'custom',message:'Reference provenance/comparison counts mismatch.'});
});
export const referenceLibrary=referenceLibrarySchema.parse(data);
export const referenceSetRevision=hash(approvalJson(referenceLibrary));
export const rubricRevision=`${SCRIPT_RUBRIC_REVISION}:${hash(approvalJson(SCRIPT_RUBRIC)).slice(0,16)}`;
type Source={title:string;revision:string;facts:{value:string}[]};
export function selectContentReferences(source:Source,records:readonly ContentReference[]=referenceLibrary.records){
 const text=`${source.title} ${source.facts.map(f=>f.value).join(' ')}`.toLowerCase();
 const traits=['run','jump','chase','horror','card','puzzle','cooperative','mirror','shop','survival'];
 const matching=(r:ContentReference)=>traits.filter(t=>new RegExp(`\\b${t}(?:s|ning|ner)?\\b`,'i').test(text)&&new RegExp(`\\b${t}(?:s|ning|ner)?\\b`,'i').test(`${r.caption_excerpt} ${r.frames.join(' ')}`));
 const relevanceScore=(r:ContentReference)=>traits.reduce((n,t)=>{const pattern=new RegExp(`\\b${t}(?:s|ning|ner)?\\b`,'i');return pattern.test(text)?n+(pattern.test(r.frames.join(' '))?3:0)+(pattern.test(r.caption_excerpt)?1:0):n;},0);
 const rank=(a:ContentReference,b:ContentReference)=>relevanceScore(b)-relevanceScore(a)||a.id.localeCompare(b.id);
 const choose=(lane:ContentReference['lane'],role:ContentReference['comparison_role'])=>records.filter(r=>r.lane===lane&&r.comparison_role===role).sort(rank)[0];
 return [choose('gameplay_promotion','higher_reach_reference'),choose('gameplay_promotion','lower_reach_comparator'),choose('ai_video','higher_reach_reference')].filter((r):r is ContentReference=>!!r).map(r=>({reference:r,relevance:matching(r).length?`Shared observed topic: ${matching(r).join(', ')}. Structure only; not evidence of target-game capabilities.`:r.lane==='gameplay_promotion'?'Gameplay caption/visual comparison; exact genre fit is unestablished.':'Cross-genre AI caption/visual inspiration; weaker gameplay relevance.'}));
}
export function referenceContext(source:Source){
 const selected=selectContentReferences(source),referenceIds=selected.map(s=>s.reference.id);
 return {referenceSetId:referenceLibrary.set_id,referenceSetRevision,rubricRevision,referenceIds,reviewContextRevision:hash(approvalJson({sourceRevision:source.revision,referenceSetRevision,rubricRevision,referenceIds})),
 referenceSummaries:selected.map(({reference:r,relevance})=>JSON.stringify({id:r.id,url:r.url,lane:r.lane,role:r.comparison_role,aiStatus:r.ai_status,caption:r.caption_excerpt.slice(0,220),visual:r.frames[0].slice(0,220),postViews:r.metrics.post_views,observedAt:r.observed_at,relevance,scope:'Caption and sampled frame only. No measured pacing, full script, audio or predictive validity.',claimWarning:r.claim_warning?.slice(0,200)||null}))};
}
export const referenceStructure='Open with one specific documented player action or goal, demonstrate it, then show its actual observed result. References suggest structure only; never copy another game’s capabilities, assets or claims.';
