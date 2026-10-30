import type {ScriptScore} from '@/lib/content-scripts';
const dimensions=['hook','pacing','clarity','shareability'] as const;
export default function ScriptReviewScore({score,stale=false}:{score:ScriptScore;stale?:boolean}) {
  return <section className={`script-score${stale?' is-stale':''}`} aria-label={stale?'Earlier Jev score, stale':'Jev review score'}>
    <header><div><span className="score-eyebrow">Script review</span><strong className="score-total">{stale?'Earlier Jev score (stale)':'Jev score'}: {score.overall}/100</strong></div><p>{stale?'This score cannot approve the current draft.':'Creative review · not a prediction of virality.'}</p></header>
    <dl className="score-dimensions">{dimensions.map(k=><div key={k}><dt>{k}</dt><dd><strong>{score[k].score}<span>/25</span></strong><p>{score[k].explanation}</p></dd></div>)}</dl>
    <div className="score-improvements"><h5>Suggested improvements</h5><ul>{score.improvements.map((x,i)=><li key={i}>{x}</li>)}</ul></div>
  </section>;
}
