import type { Analytics } from "./types";
function cell(value: string | number | null | undefined) {
  let text = value == null ? "" : String(value);
  // Spreadsheet programs interpret quoted formula strings too.
  if (/^[\s]*[=+@-]/.test(text) || /^[\t\r\n]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"','""')}"`;
}
export function analyticsCsv(a: Analytics, context: { days: number; gameId?: string; generatedAt: string }) {
  const rows: (string | number | null | undefined)[][] = [["section","label","date","value","eligible","returned","rate"]];
  rows.push(["metadata","generated_at",context.generatedAt],["metadata","window_days","",context.days],["metadata","game_id","",context.gameId || "all"]);
  const metrics = { sessions:a.sessions, browser_ids:a.players, round_starts:a.starts, completed_sessions:a.completions, replay_sessions:a.replays, returning_browser_ids:a.returns, error_sessions:a.errorSessions, first_action_sessions:a.firstActions, active_play_seconds:a.activePlay?.totalSeconds, active_play_measured_sessions:a.activePlay?.measuredSessions, active_play_eligible_sessions:a.activePlay?.eligibleSessions };
  for(const [label,value] of Object.entries(metrics)) rows.push(["summary",label,"",value]);
  for(const row of a.trend) for(const name of ["visits","starts","completions"] as const) rows.push(["trend",name,row.date,row[name]]);
  for(const row of a.funnel) rows.push(["funnel",row.name,"",row.count]);
  for(const [section,values] of [["source",a.sources],["country",a.countries],["device",a.devices]] as const) for(const row of values) rows.push([section,row.name,"",row.count]);
  for(const row of a.retention) rows.push(["d1_cohort","browser_ids",row.date,row.players,row.eligible,row.returned,row.rate]);
  rows.push(["caveat","Aggregates only. Browser IDs are not people. Missing data is not zero; returns require mature cohorts. Consent, delivery and instrumentation limit coverage. Retention policy may remove historical event evidence."]);
  return '\uFEFF'+rows.map(row=>Array.from({length:7},(_,i)=>cell(row[i])).join(',')).join('\r\n')+'\r\n';
}
