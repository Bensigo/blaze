import './player-analytics.css';
import InfoHint from './info-hint';
import type {Audience} from '@/lib/audience';

const count=(n:number)=>n.toLocaleString();
const region=(name:string)=>/^[A-Z]{2}$/.test(name)?new Intl.DisplayNames(['en'],{type:'region'}).of(name)??name:name;
export function AudienceBreakdown({data}:{data:Audience}){
 const breakdowns=[
  {title:'Approximate connection country',rows:data.countries,country:true},
  {title:'Self-reported age range',rows:data.ageBands},
  {title:'Self-reported home country',rows:data.declaredCountries,country:true},
  {title:'Self-reported interests',rows:data.interests},
 ];
 return <section className="cohort-section audience-breakdown">
  <h2>Audience and optional profile <InfoHint label="About audience counts">Consented browser IDs, not people. {count(data.unlinkedGameBrowserIds)} game-specific IDs cannot be linked across games. Segments overlap within the selected window. Missing answers stay unknown; demographics are self-reported. Connection country is approximate and can reflect a VPN. Interests allow multiple answers.</InfoHint></h2>
  <p>{count(data.browserIds)} browser IDs · {count(data.profileRespondents)} with optional answers</p>
  <div className="table-wrap"><table><thead><tr><th>Behaviour segment</th><th>Browser IDs</th></tr></thead><tbody>{data.segments.map(row=><tr key={row.name}><td>{row.name}</td><td>{count(row.count)}</td></tr>)}</tbody></table></div>
  <div className="audience-breakdowns">{breakdowns.map(({title,rows,country})=><div key={title}><h3>{title}</h3>{rows.length?<ul>{rows.map(row=><li key={row.name}>{country?region(row.name):row.name==='55-plus'?'55+':row.name}: {count(row.count)}</li>)}</ul>:<p>No measured answers yet.</p>}</div>)}</div>
 </section>;
}
