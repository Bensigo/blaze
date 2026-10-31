import type {ScriptScore} from '@/lib/content-scripts';
import InfoHint from './info-hint';
const dimensions=['hook','pacing','clarity','shareability'] as const;
export default function ScriptReviewScore({score,stale=false}:{score:ScriptScore;stale?:boolean}) {
  return <section className={`script-score${stale?' is-stale':''}`} aria-label={stale?'Earlier Content score, stale':'Content review score'}>
    <header><div><span className="score-eyebrow">Script review</span><strong className="score-total">{stale?'Earlier Content score (stale)':'Content score'}: {score.overall}/100</strong></div><p>{stale?'This score cannot approve the current draft.':'Creative review · not a prediction of virality.'}</p></header>
    <dl className="score-dimensions">{dimensions.map(k=><div key={k}><dt>{k}<InfoHint label={`${k} score explanation`}>{score[k].explanation}</InfoHint></dt><dd><strong>{score[k].score}<span>/25</span></strong><span className="score-meter" aria-hidden="true"><i style={{width:`${score[k].score/25*100}%`}}/></span></dd></div>)}</dl>
    <div className="score-improvements"><h5>Suggested improvements</h5><ul>{score.improvements.map((x,i)=><li key={i}>{x}</li>)}</ul></div>
  </section>;
}
