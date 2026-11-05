"use client";

import { useEffect, useState } from "react";
import { RefreshCw, AlertCircle } from "lucide-react";
import { browserRead } from "@/lib/browser-read";
import type { ForeverReport, ForeverStatus } from "@/lib/forever-observability";
import "./forever-health.css";

const number = (value: number) => value.toLocaleString();
const label = (value: string) => value.replaceAll("_", " ").replaceAll("-", " ");
const gameNames: Record<string, string> = { "site": "Website", "last-card": "WHOT", "boxing": "Punching Bag", "paintball": "Battle Royale", "keke-smash": "Tuk Tuk Rush", "dog-chase": "Dog Chase", "rage-football": "Rage Football", "bible-learning": "Bible Journey", "table-soccer": "Table Soccer", "biro-fight": "Biro Fight", "ludo": "Ludo", "colour-pour": "Colour Pour" };
const gameName = (value: string) => gameNames[value] ?? label(value);
const date = (value: string) => new Date(value).toLocaleString();
const stageLabels: Record<string, string> = { visit: "Website visit", game_view: "Game page viewed", play_click: "Play clicked", game_ready: "Game ready", round_start: "Round started", first_action: "First gameplay action", round_complete: "Round completed" };

export default function ForeverHealth({ demo = false }: { demo?: boolean }) {
  const [state, setState] = useState<ForeverStatus>();
  const [loading, setLoading] = useState(!demo);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const [selected, setSelected] = useState("");
  useEffect(() => {
    if (demo) return;
    const controller = new AbortController();
    setLoading(true); setError(""); setSelected(""); setState(undefined);
    void browserRead<ForeverStatus>("/api/forever/observability", controller.signal).then(value => { if (!controller.signal.aborted) setState(value); }).catch(e => { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "Diagnostics could not be loaded."); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [revision, demo]);
  const report = state?.status === "connected" ? state.report : undefined;
  return <div className="forever-health" aria-busy={loading}>
    <div className="fh-scope"><div><strong>playforever.app</strong><span>Internal diagnostics · last 14 days</span></div><button className="button" disabled={loading || demo} onClick={() => setRevision(n => n + 1)}><RefreshCw size={14} className={loading ? "spin" : undefined}/> Refresh</button></div>
    {demo ? <div className="fh-empty"><h2>Forever’s live report is private</h2><p>Open the connected internal workspace to see website visits and issues. Example data is not used here.</p></div> : loading ? <p role="status">Loading Forever diagnostics…</p> : error ? <div className="fh-empty" role="alert"><h2>Diagnostics unavailable</h2><p>{error}</p></div> : state && state.status !== "connected" ? <div className="fh-empty" role="status"><h2>{state.status === "not_configured" ? "Connect Forever’s private report" : "Diagnostics unavailable"}</h2><p>{state.reason}</p><p>Once connected, this view includes visits before a game is opened, Play clicks, actual round starts, and classified failures.</p></div> : report ? <>
      <div className="fh-freshness">Report generated {date(report.generatedAt)} · {date(report.window.since)} – {date(report.window.until)}{report.release ? ` · release ${report.release.slice(0, 8)}` : ""}</div>
      <div className="fh-metrics">
        <Metric title="Website visits" value={report.summary.sessions} detail="In-memory browser sessions"/>
        <Metric title="Never started a round" value={report.summary.noPlaySessions} detail={report.summary.sessions ? `${Math.round(report.summary.noPlaySessions / report.summary.sessions * 100)}% of recorded visits` : "Waiting for visits"}/>
        <Metric title="Started a round" value={report.summary.startedSessions} detail={`${number(report.summary.actionSessions)} with a reported action · coverage varies`}/>
        <Metric title="Sessions with errors" value={report.summary.errorSessions} detail="At least one classified browser issue"/>
        {report.summary.completedSessions !== undefined && <Metric title="Completed a round" value={report.summary.completedSessions} detail="Recorded visits with at least one completion; overlaps errors"/>}
        {report.journey && <Metric title="Started a second game" value={report.journey.secondGameSessions} detail={report.journey.secondGameRate === null ? "No recorded starters yet" : `${(100*report.journey.secondGameRate).toFixed(1)}% of ${number(report.journey.startedSessions)} first-game starters · same document visit`}/>}
      </div>
      <div className="fh-main"><section><h2>Game-page funnel</h2><p className="fh-muted">One game’s stages in order. Direct launches and resumed rounds may skip steps; observed totals above still include them.</p><div className="fh-funnel">{report.funnel.map(row => <div key={row.stage}><span>{stageLabels[row.stage] ?? label(row.stage)}</span><i><b style={{ width: `${report.summary.sessions ? Math.min(100, row.sessions / report.summary.sessions * 100) : 0}%` }}/></i><strong>{number(row.sessions)}</strong></div>)}</div><p className="fh-muted">“Never started a round” means no round-start event was recorded. Missing events, an open tab, or an early exit can also cause this.</p></section><section><h2>What to investigate</h2><p>{report.summary.sessions === 0 ? "No visits have reached this instrumentation yet. Verify a normal browser visit after release." : report.summary.noPlaySessions > 0 ? `${number(report.summary.noPlaySessions)} recorded visits did not start a round. Compare game-page views with Play clicks and readiness below.` : "Every recorded visit has a round start. Check gameplay actions and error evidence next."}</p><p>{report.errors.length ? "Start with repeated errors on the same game, browser and device. A failure in the same session is evidence to investigate; it does not establish why someone left." : "No classified issues were reported in this window. This does not prove the site was error-free."}</p><div className={`fh-delivery ${report.delivery.dropped || report.delivery.writeFailures ? "fh-warning" : ""}`}><AlertCircle size={16}/><span>Delivery: {number(report.delivery.pending)} pending · {number(report.delivery.dropped)} dropped · {number(report.delivery.writeFailures)} write failures</span></div></section></div>
      <section><h2>Game entry and play</h2><p className="fh-muted">Session presence per game. One visit may open several games; these rows do not add up to unique people. Unmeasured actions stay unknown; a recorded completion is shown separately.</p><div className="table-wrap"><table><thead><tr><th>Game</th><th>Viewed</th><th>Play clicked</th><th>Ready</th><th>Round started</th><th>Gameplay action</th><th>Completed</th><th>With errors</th></tr></thead><tbody>{report.games.map(game => <tr key={game.game}><td>{gameName(game.game)}</td><td>{number(game.views)}</td><td>{number(game.playClicks)}</td><td>{number(game.ready)}</td><td>{number(game.starts)}</td><td>{game.actions === null ? "Unmeasured" : number(game.actions)}{game.actionCoverage === "finish_only" && <small>Reported at finish only</small>}</td><td>{number(game.completed)}</td><td>{number(game.errorSessions)}</td></tr>)}</tbody></table></div>{!report.games.length && <p className="fh-muted">No game observations in this window.</p>}</section>
      <section><h2>Reported issues</h2><p className="fh-muted">Fixed diagnostic codes, grouped by game, browser and device. Server issues are separate from browser sessions.</p>{report.errors.length ? <div className="table-wrap"><table><thead><tr><th>Issue</th><th>Game</th><th>Source</th><th>Browser / device</th><th>Reports</th><th>Sessions</th><th>Last seen</th></tr></thead><tbody>{report.errors.map((issue, i) => <tr key={i}><td><code>{issue.code}</code></td><td>{gameName(issue.game)}</td><td>{issue.source}</td><td>{label(issue.browser)} / {label(issue.device)}</td><td>{number(issue.count)}</td><td>{issue.source === "server" ? "—" : number(issue.sessions)}</td><td>{date(issue.lastAt)}</td></tr>)}</tbody></table></div> : <p className="fh-muted">No classified issues received.</p>}</section>
      {report.journey && <section><h2>First game → second game</h2><p className="fh-muted">Different games started in order during one document visit. Replaying the same game does not count. Reloads start a new visit; this is an observed rate, not a prediction.</p>{report.journey.transitions.length ? <div className="table-wrap"><table><thead><tr><th>First game</th><th>Second game</th><th>Visits</th></tr></thead><tbody>{report.journey.transitions.map(t=><tr key={`${t.from}:${t.to}`}><td>{gameName(t.from)}</td><td>{gameName(t.to)}</td><td>{number(t.sessions)}</td></tr>)}</tbody></table></div> : <p>No second-game starts recorded yet.</p>}</section>}
      {report.catalogue && <section><h2>Live Forever catalogue</h2><p>{report.catalogue.length} listed games on the reported release. Games without events remain visible here; historical game rows above are retained.</p><ul>{report.catalogue.map(g=><li key={g.id}><a href={g.url} target="_blank" rel="noreferrer">{g.title}</a></li>)}</ul></section>}
      <Recent report={report} selected={selected} onSelect={setSelected}/>
      <details className="fh-limitations"><summary>Measurement coverage and limits</summary><ul>{report.limitations.map((item, i) => <li key={i}>{item}</li>)}</ul><p>Fixed codes only. No messages, input text, private URLs, recordings, or account identifiers are included in this report.</p></details>
    </> : null}
  </div>;
}
function Metric({ title, value, detail }: { title: string; value: number; detail: string }) { return <div><span>{title}</span><strong>{number(value)}</strong><small>{detail}</small></div>; }
function Recent({ report, selected, onSelect }: { report: ForeverReport; selected: string; onSelect: (value: string) => void }) {
  const sessions = [...new Set(report.recent.map(row => row.session))];
  const chosen = sessions.includes(selected) ? selected : sessions[0];
  return <section><div className="fh-recent-heading"><div><h2>Recent session evidence</h2><p className="fh-muted">A bounded sample in event sequence, earliest to latest. Receipt times may differ from event order.</p></div>{sessions.length > 0 && <label>Session<select aria-label="Diagnostic session" value={chosen} onChange={event => onSelect(event.target.value)}>{sessions.map(id => <option key={id} value={id}>{id.slice(0, 12)}</option>)}</select></label>}</div>{chosen ? <ol className="fh-timeline">{report.recent.filter(row => row.session === chosen).map((row, i) => <li key={i}><time>{date(row.at)}</time><strong>{stageLabels[row.stage] ?? label(row.stage)}{row.code ? ` · ${label(row.code)}` : ""}</strong><span>{gameName(row.game)} · {label(row.browser)} · {label(row.device)}</span></li>)}</ol> : <p className="fh-muted">No recent session evidence available.</p>}</section>;
}
