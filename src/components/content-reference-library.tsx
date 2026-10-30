'use client';
import {useState} from 'react';
import library from '@/data/content-references-v2.json';
import InfoHint from './info-hint';
export default function ContentReferenceLibrary({selected=[],revision}:{selected?:{id:string;relevance:string}[];revision?:string}) {
 const [filter,setFilter]=useState('selected');const selectedIds=new Set(selected.map(x=>x.id));
 const records=library.records.filter(r=>filter==='selected'?(selectedIds.size?selectedIds.has(r.id):true):filter==='all'||r.lane===filter);
 return <details className="studio-reference-library"><summary>Reference library · 24 observed X posts</summary>
  <p>14 AI ·10 gameplay ·4 lower-reach comparisons <InfoHint label="About these references">Observed X post views, not video plays or unique viewers. Captions and sampled frames only; no measured pacing or full audio transcripts. These examples are not a validated viral formula.</InfoHint></p>
  <label>Show references<select value={filter} onChange={e=>setFilter(e.target.value)}><option value="selected">{selectedIds.size?'Selected for this game':'All references · select a game to narrow'}</option><option value="gameplay_promotion">Gameplay · 10</option><option value="ai_video">AI video · 14</option><option value="all">All · 24</option></select></label>
  <div className="reference-list">{records.map(r=><article key={r.id}>
    <header><div><a href={r.url} target="_blank" rel="noreferrer">{r.title} ↗</a><p>{r.lane==='gameplay_promotion'?'Gameplay · AI use unknown':r.ai_status==='creator_disclosed'?'AI · creator disclosed':'AI · secondary reported, exact model unverified'} · {r.comparison_role==='lower_reach_comparator'?'Lower-reach comparison':'Higher-reach reference'}</p></div><div className="reference-metric"><strong>{r.metrics.post_views.toLocaleString('en-US')}</strong><span>observed post views</span></div></header>
    {selected.find(x=>x.id===r.id)?.relevance&&<p>{selected.find(x=>x.id===r.id)!.relevance}</p>}
    <details><summary>Caption, sampled visuals and provenance</summary><blockquote>{r.caption_excerpt}</blockquote><ul>{r.frames.map((f,i)=><li key={i}>{f}</li>)}</ul><p>{r.inspection} Observed {r.observed_at}. Post date shown by X: {r.date_visible||'unavailable'} (visible timezone unconfirmed; edited date is not original publication). AI disclosure: {r.ai_disclosure||'Unknown; not assumed AI-generated.'}</p>{r.claim_warning&&<p>{r.claim_warning}</p>}{r.creator_workflow_summary&&<p>Creator-reported planning: {r.creator_workflow_summary}</p>}<p>Reference {r.id}. No predictive calibration, retention measurements or causal attribution. Creator concentration and other confounders limit comparisons.</p></details>
  </article>)}</div><small>Reference set {library.set_id}{revision?` · ${revision.slice(0,12)}`:''}. Reviews created before this library did not include these examples. A new review requires separate approval.</small>
 </details>;
}
