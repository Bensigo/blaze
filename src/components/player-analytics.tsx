"use client";
import AudienceGlobe from "./audience-globe";
import {AudienceBreakdown} from './audience-breakdown';

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { ArrowRight, ChevronRight, Gamepad2, LoaderCircle, Plus, RefreshCw } from "lucide-react";
import { Area, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { Analytics, Game, SessionSummary } from "@/lib/types";
import LaunchLinks from "./launch-links";
import InfoHint from "./info-hint";
import { browserRead } from "@/lib/browser-read";
import type { HeatmapContext, HeatmapResponse } from "@/lib/heatmap";

const count = (n: number | undefined) => n === undefined ? "—" : n.toLocaleString();
const duration = (n?: number | null) => n == null ? "—" : n < 60 ? `${Math.floor(n)}s` : `${Math.floor(n / 60)}m ${Math.floor(n % 60)}s`;
const when = (value: string) => new Date(value).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
const contextKey = (c: HeatmapContext) => `${c.surface}:${c.screen}:${c.device}`;

type Props = {
  view?: "overview" | "engagement" | "acquisition" | "retention" | "audience";
  analytics?: Analytics; games: Game[]; gameId: string; days: string; demo?: boolean; detailed?: boolean;
  onChooseGame: (id: string) => void; onAddGame: () => void; onSetup: () => void;
  onAnalytics?: () => void; onSessions: () => void; onOpenSession: (session: SessionSummary) => void;
  onDropoff: (name: string) => void;
  onClearEvidence: () => void;
  onBin: (context: HeatmapContext, bx: number, by: number, sessionId?: string) => void;
  supporting?: ReactNode;
};

export default function PlayerAnalytics(props: Props) {
  const { analytics: a, games, gameId, days, demo, detailed } = props;
  const view = props.view || "overview";
  const engagement = view === "overview" || view === "engagement";
  const cohorts = (a?.retention || []).filter(row => row.players > 0);
  if (!games.length) return <div className="analytics-onboarding">
    <div className="onboarding-title"><Gamepad2 size={26} /><span>No games connected</span></div>
    <h2>Connect your first game</h2>
    <p>Paste the public game page URL. Blaze reads available metadata and gives you the SDK setup for that game.</p>
    <button className="button primary" onClick={props.onAddGame}><Plus size={16} /> Add game</button>
    <ol className="connection-steps">
      <li><span>1</span><div><strong>Import the game</strong><p>Review the available name, description and artwork.</p></div></li>
      <li><span>2</span><div><strong>Install the SDK and consent controls</strong><p>Collect visits, starts, actions, completions and pointer coordinates when players opt in.</p></div></li>
      <li><span>3</span><div><strong>Review the evidence here</strong><p>Charts, sessions and heatmaps appear as your game sends data.</p></div></li>
    </ol>
    <div className="onboarding-foot">Your workspace contains no player activity. Controlled tests and the example workspace are separate.</div>
  </div>;
  return <div className="player-workspace">
    <div className="player-scope"><span className="scope-dot" />{demo ? "Illustrative example data" : "Human player activity"}<span>{a?.lastEventAt ? `Latest event ${when(a.lastEventAt)}` : "No events received"}</span>{view === "engagement"?<a href="#pointer-heatmap">Heatmap ↓</a>:view === "overview"?<button className="text-action" onClick={props.onAnalytics}>Engagement <ArrowRight size={14}/></button>:null}</div>

    {engagement && <><div className="player-kpis">
      <Metric label={gameId === "all" ? "Per-game browser IDs" : "Browser IDs"} value={count(a?.players)} detail="Browser-scoped IDs, not people" />
      <Metric label="Visits" value={count(a?.launch?.visits)} detail="Sessions with a visit event" />
      <Metric label="Observed exits" value={count(a?.launch?.exits)} detail="Sessions with an exit event" />
      <Metric label="Sessions played" value={count(a?.starts)} detail="At least one round started" />
      <Metric label="Completed sessions" value={count(a?.completions)} detail="At least one completion recorded" />
      <Metric label="Active play" value={duration(a?.activePlay?.totalSeconds)} detail={a?.activePlay ? `${a.activePlay.measuredSessions} / ${a.activePlay.eligibleSessions} play sessions measured` : "Measurement unavailable"} />
    </div>
    {!a?.sessions && <div className="instrumentation-note"><div><strong>Waiting for consented player events</strong><p>{a?.lastEventAt ? "No human sessions fall in this date range. Change the game or dates to inspect other activity." : "Connect the SDK, opt in during a test visit, and start a round. Missing data stays empty."}</p></div><button className="text-action" onClick={props.onSetup}>SDK setup <ArrowRight size={14}/></button></div>}
    <div className={`player-visuals${detailed?"":" overview-visuals"}`}>
      <div className="activity-column">
        <section className="activity-panel"><div className="analytics-section-title"><div><h2>Sessions over time</h2><p>Daily UTC counts · last {days} days</p></div><span className="chart-unit">Sessions</span></div>
          {a?.sessions ? <><div className="activity-chart"><ResponsiveContainer width="100%" height="100%"><ComposedChart data={a.trend} margin={{top:12,right:10,left:-25,bottom:0}}>
            <defs><linearGradient id="player-session-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#5a8e70" stopOpacity={0.2}/><stop offset="100%" stopColor="#5a8e70" stopOpacity={0.01}/></linearGradient></defs>
            <CartesianGrid vertical={false} stroke="#e7ebe8"/><XAxis dataKey="date" axisLine={false} tickLine={false} minTickGap={25} tick={{fontSize:10,fill:"#68756c"}} tickFormatter={v=>String(v).slice(5)}/><YAxis axisLine={false} tickLine={false} allowDecimals={false} tick={{fontSize:10,fill:"#68756c"}}/>
            <Tooltip contentStyle={{border:"1px solid #dce4de",borderRadius:6,fontSize:12,boxShadow:"0 5px 20px #16251a0a"}} labelFormatter={v=>`${v} · UTC`} />
            <Area type="linear" dataKey="visits" name="Sessions" stroke="#32754f" strokeWidth={2} fill="url(#player-session-fill)" isAnimationActive={false}/>
            <Line type="linear" dataKey="starts" name="With a round start" stroke="#203d2c" strokeWidth={2} dot={false} strokeDasharray="5 4" isAnimationActive={false}/>
            <Line type="linear" dataKey="completions" name="With a completion" stroke="#9c7840" strokeWidth={2} dot={false} isAnimationActive={false}/>
          </ComposedChart></ResponsiveContainer></div><div className="activity-legend"><span>Sessions</span><span>With a start</span><span>With a completion</span></div></> : <div className="data-empty chart-data-empty"><strong>No sessions to chart</strong><p>The first consented visit starts this timeline.</p></div>}
        </section>
        {detailed&&<section className="funnel-panel"><div className="analytics-section-title"><div><h2>Visit to completion</h2><p>Sessions that reached each step in order</p></div></div>
          <div className="ordered-funnel">{(a?.funnel || []).map((step,i)=>{const base=a?.funnel[0]?.count || 0;const percent=base ? Math.round(step.count/base*100) : null;return <div key={step.name}><span>{step.name}</span><div className="ordered-track"><i style={{width:`${percent || 0}%`}}/></div><strong>{count(step.count)}</strong><small>{i===0 ? "" : percent===null ? "—" : `${percent}%`}</small></div>;})}</div>
          {!a?.sessions && <p className="quiet-help">Requires <code>visit → loaded → round_start → first_action → round_complete</code>. The first action may occur before or after the round starts.</p>}
          <div className="progression-observation"><span>Sessions reporting progression</span><strong>{count(a?.progressionSessions)}</strong></div>
        </section>}
      </div>
      {detailed&&<PointerHeatmap games={games} gameId={gameId} days={days} end={a?.windowEnd} demo={demo} onChooseGame={props.onChooseGame} onSetup={props.onSetup} onBin={props.onBin} onClearEvidence={props.onClearEvidence}/>}
    </div>
    {detailed&&<section className="play-measurement"><div><h2>Measured play time <InfoHint label="About measured play time">Foreground time with recent input after a round starts. Idle tabs and agent sessions are excluded. Only sessions supplying active_play measurements contribute to these statistics.</InfoHint></h2><p>Active foreground play · idle time excluded</p></div><dl><div><dt>Average active play</dt><dd>{duration(a?.activePlay?.averageSeconds)}</dd></div><div><dt>Median active play</dt><dd>{duration(a?.activePlay?.medianSeconds)}</dd></div><div><dt>Coverage</dt><dd>{a?.activePlay ? `${a.activePlay.measuredSessions} / ${a.activePlay.eligibleSessions}` : "—"}</dd></div></dl><p className="quiet-help">{a?.activePlay?.measuredSessions ? "Statistics include measured sessions only; elapsed time is not active play." : "No active_play measurements yet. Elapsed session time is not a play-time measurement."}</p></section>}
    <div className="player-detail-grid"><section><div className="analytics-section-title"><div><h2>Recent sessions</h2><p>Open a session to inspect its events and consented capture</p></div><button className="text-action" onClick={props.onSessions}>All sessions <ArrowRight size={14}/></button></div>
      {a?.sessionsList.length ? <div className="table-wrap player-session-table"><table><thead><tr><th>Session</th><th>Device</th><th>Active play</th><th>Elapsed</th><th>Last step</th><th>Result</th></tr></thead><tbody>{a.sessionsList.slice(0,6).map(s=><tr key={`${s.gameId}:${s.id}`} onClick={()=>props.onOpenSession(s)}><td><button className="session-link" onClick={e=>{e.stopPropagation();props.onOpenSession(s);}}>{when(s.startedAt)}<small>{s.id.slice(0,10)}</small></button></td><td>{s.device}<small>{s.country}</small></td><td>{duration(s.activePlaySeconds)}</td><td>{duration(s.duration)}</td><td>{s.lastStep.replaceAll("_", " ")}</td><td>{s.completed ? "Completed" : "No completion"}</td></tr>)}</tbody></table></div> : <div className="data-empty compact-empty"><strong>No sessions in this range</strong><p>Consented human sessions will appear here.</p></div>}
    </section><section><div className="analytics-section-title"><div><h2>Sessions without completion</h2><p>Last recorded steps; these do not explain player intent</p></div></div>{a?.dropoffs.length ? <div className="dropoff-rows">{a.dropoffs.map(row=><button key={row.name} disabled={gameId==="all"||demo} onClick={()=>props.onDropoff(row.name)}><span>{row.name}</span><strong>{count(row.count)}</strong><ChevronRight size={14}/></button>)}{gameId==="all"&&<p className="quiet-help">Select one game to open supporting sessions.</p>}</div> : <div className="data-empty compact-empty"><strong>No unfinished sessions recorded</strong><p>Drop-off evidence appears as visits and rounds are measured.</p></div>}</section></div>
    </>}
    {view === "engagement" && <>
<section className="cohort-section"><div className="analytics-section-title"><div><h2>Instrumentation coverage</h2><p>Event presence across human sessions in the selected game and date range. Missing events do not prove an action never happened.</p></div></div>{a?.launch?.coverage ? <div className="table-wrap"><table><thead><tr><th>Event</th><th>Sessions reporting event / human sessions</th></tr></thead><tbody>{([['Visit',a.launch.coverage.visit],['Loaded',a.launch.coverage.loaded],['Round start',a.launch.coverage.roundStart],['First action',a.launch.coverage.firstAction],['Round complete',a.launch.coverage.roundComplete],['Exit',a.launch.coverage.exit]] as const).map(([name,n])=><tr key={name}><td>{name}</td><td>{count(n)} / {count(a.launch!.coverage!.sessions)}</td></tr>)}</tbody></table></div> : <p className="quiet-help">Event coverage unavailable.</p>}</section>
    </>}
    {view === "audience" && <AudienceGlobe countries={a?.audience?.countries ?? a?.countries ?? []} unit={a?.audience ? "browser IDs" : "sessions"}/>}
    {view === "audience" && a?.audience && <AudienceBreakdown data={a.audience}/>}
    {view === "acquisition" && <><section className="cohort-section"><div className="analytics-section-title"><div><h2>Launch conversion <InfoHint label="About launch conversion">Meaningful play is a start followed by a completion, or a start with at least 30 seconds of measured active play. Source combines tags and referrer hostnames. Direct means no usable referrer or tag, not proof of direct traffic; Unknown means no stored source. Attribution does not establish causation.</InfoHint></h2><p>Visit sessions by first recorded source and campaign.</p></div></div>
      <p className="quiet-help">Starts and meaningful play use visits as the denominator. Missing active measurement is unknown; meaningful play is an observed lower bound. Attribution is incomplete.</p>
      {a?.launch?.conversion.length ? <div className="table-wrap"><table><thead><tr><th>Source</th><th>Campaign</th><th>Visits</th><th>Starts</th><th>Meaningful play</th><th>Starts with active measurement</th></tr></thead><tbody>{a.launch.conversion.map(r=><tr key={JSON.stringify([r.source,r.campaign])}><td>{r.source}</td><td>{r.campaign}</td><td>{count(r.visits)}</td><td>{count(r.starts)}</td><td>{count(r.meaningful)}</td><td>{count(r.activeMeasured)}</td></tr>)}</tbody></table></div> : <p className="quiet-help">No visit events in this selection.</p>}
      {!!a?.launch && a.launch.conversionTotal > a.launch.conversion.length && <p className="quiet-help">Showing {a.launch.conversion.length} of {a.launch.conversionTotal} source and campaign groups.</p>}
    </section>
</>}
    {engagement && props.supporting}
    {view === "acquisition" && <LaunchLinks games={games} gameId={gameId}/>}
    {view === "acquisition" && <div className="player-breakdowns"><Breakdown title="Traffic sources" rows={a?.sources || []}/></div>}
    {view === "audience" && <div className="player-breakdowns"><Breakdown title="Countries" rows={a?.countries || []}/><Breakdown title="Devices" rows={a?.devices || []}/></div>}
    {view === "retention" && <>
      <section className="cohort-section"><div className="analytics-section-title"><div><h2>Next-day return <InfoHint label="About next-day return">A visit in a different session at least 24 hours and less than 48 hours after the first observed human event. Cohorts mature after 48 hours.</InfoHint></h2><p>Cohorts mature after 48 hours.</p></div></div>{cohorts.length ? <div className="table-wrap"><table><thead><tr><th>First observed event cohort</th><th>Browser IDs</th><th>Eligible</th><th>Returned</th><th>Return rate</th></tr></thead><tbody>{cohorts.map(r=><tr key={r.date}><td>{r.date}</td><td>{count(r.players)}</td><td>{count(r.eligible)}</td><td>{count(r.returned)}</td><td>{r.rate===null ? "Not mature" : `${Math.round(r.rate*100)}%`}</td></tr>)}</tbody></table></div> : <p className="quiet-help">No browser ID cohorts yet. Return measurement begins with the first observed human event.</p>}</section>
    </>}
    {view === "acquisition" && <>
      <section className="cohort-section"><div className="analytics-section-title"><div><h2>Campaign traffic <InfoHint label="About campaign traffic">Returning IDs had a different session at least 24 hours after their first observed event during this window. A returning session need not carry this campaign.</InfoHint></h2><p>Sessions grouped by recorded campaign.</p></div></div>{a?.campaigns.length ? <div className="table-wrap"><table><thead><tr><th>Campaign</th><th>Sessions</th><th>With a start</th><th>With a completion</th><th>Returning browser IDs</th></tr></thead><tbody>{a.campaigns.map(c=><tr key={c.name}><td>{c.name}</td><td>{count(c.visits)}</td><td>{count(c.starts)}</td><td>{count(c.completions)}</td><td>{count(c.returns)}</td></tr>)}</tbody></table></div> : <p className="quiet-help">No attributed campaign sessions in this range. Use the game's tracked links to measure them.</p>}</section>
    </>}
    <div className="analytics-footnote">Human traffic only · {count(a?.syntheticSessions)} synthetic sessions excluded. Missing coordinates or play-time measurements remain unknown.</div>
  </div>;
}

function Metric({label,value,detail}:{label:string;value:string;detail:string}) { return <div><span>{label}<InfoHint label={`About ${label}`}>{detail}</InfoHint></span><strong>{value}</strong>{label==="Active play"&&<small>{detail}</small>}</div>; }
function Breakdown({title,rows}:{title:string;rows:{name:string;count:number}[]}) {const max=Math.max(1,...rows.map(r=>r.count));return <section><h2>{title}</h2>{rows.length ? rows.slice(0,6).map(r=><div className="player-breakdown-row" key={r.name}><span>{r.name||"Unknown"}</span><i><b style={{width:`${r.count/max*100}%`}}/></i><strong>{count(r.count)}</strong></div>) : <p className="quiet-help">No observations in this range.</p>}</section>;}

function PointerHeatmap({games,gameId,days,end,demo,onChooseGame,onSetup,onBin,onClearEvidence}:Pick<Props,"games"|"gameId"|"days"|"demo"|"onChooseGame"|"onSetup"|"onBin"|"onClearEvidence">&{end?:string}) {
  const [data,setData]=useState<HeatmapResponse>();
  const [context,setContext]=useState<HeatmapContext>();
  const [sessionId,setSessionId]=useState("");
  const [loading,setLoading]=useState(false),[error,setError]=useState(""),[retry,setRetry]=useState(0);
  const [focused,setFocused]=useState<{bx:number;by:number;count:number}>();
  const request=useRef(0);
  const key=context ? contextKey(context) : "";
  useEffect(()=>{setContext(undefined);setSessionId("");setData(undefined);setFocused(undefined);},[gameId,days]);
  useEffect(()=>{
    if(gameId==="all"||demo) return;
    const current=++request.current,controller=new AbortController();setLoading(true);setError("");setFocused(undefined);
    const p=new URLSearchParams({gameId,days});if(end)p.set("end",end);if(sessionId)p.set("sessionId",sessionId);if(context){p.set("surface",context.surface);p.set("screen",context.screen);p.set("device",context.device);}
    void browserRead<HeatmapResponse>(`/api/analytics/heatmap?${p}`,controller.signal).then(result=>{if(current===request.current)setData(result);}).catch(e=>{if(!controller.signal.aborted&&current===request.current)setError(e instanceof Error ? e.message : "Could not load coordinates");}).finally(()=>{if(current===request.current)setLoading(false);});
    return()=>{controller.abort();};
  // The context key represents all three required dimensions.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[gameId,days,end,key,sessionId,retry,demo]);
  const chosen=context || data?.selectedContext || undefined;
  const contexts=data?.contexts || [];
  const surfaces=[...new Set(contexts.map(c=>c.surface))];
  const screens=[...new Set(contexts.filter(c=>c.surface===chosen?.surface).map(c=>c.screen))];
  const devices=[...new Set(contexts.filter(c=>c.surface===chosen?.surface&&c.screen===chosen?.screen).map(c=>c.device))];
  const peak=Math.max(1,...(data?.bins || []).map(p=>p.count));
  const choose = (part: Partial<HeatmapContext>) => {
    const candidates = contexts.filter(c =>
      (part.surface === undefined || c.surface === part.surface) &&
      (part.screen === undefined || c.screen === part.screen) &&
      (part.device === undefined || c.device === part.device));
    const next = candidates.find(c => c.screen === chosen?.screen && c.device === chosen?.device) ||
      candidates.find(c => c.device === chosen?.device) || candidates[0];
    if (next) {
      onClearEvidence();
      setContext({surface: next.surface, screen: next.screen, device: next.device});
    }
  };
  const selectedGame=games.find(g=>g.id===gameId);
  const mapId=useId().replace(/[^A-Za-z0-9_-]/g, "");
  return <section id="pointer-heatmap" className="pointer-panel" aria-busy={loading}><div className="analytics-section-title"><div><h2>Pointer heatmap</h2><p>Recorded positions · one coordinate space</p></div>{loading&&<LoaderCircle className="spin" size={16} aria-label="Loading heatmap"/>}</div>
    {gameId==="all" ? <div className="heatmap-choose"><label>Game<select value="all" onChange={e=>onChooseGame(e.target.value)}><option value="all">Select a game</option>{games.map(g=><option key={g.id} value={g.id}>{g.title}</option>)}</select></label><p>Heatmaps are scoped to one game, screen and device.</p></div> : demo ? <div className="data-empty heatmap-empty"><strong>No recorded coordinates in this example</strong><p>A real heatmap requires consented pointer events from an instrumented game.</p></div> : <>
      <div className="pointer-game">{selectedGame?.title}</div>
      <div className="pointer-filters"><label>Surface<select aria-label="Heatmap surface" disabled={!contexts.length||loading} value={chosen?.surface||""} onChange={e=>choose({surface:e.target.value as HeatmapContext["surface"]})}>{!surfaces.length&&<option value="">No samples</option>}{surfaces.map(s=><option key={s} value={s}>{s==="game"?"Game surface":"Viewport"}</option>)}</select></label><label>Screen<select aria-label="Heatmap screen" disabled={!contexts.length||loading} value={chosen?.screen||""} onChange={e=>choose({surface:chosen?.surface,screen:e.target.value})}>{!screens.length&&<option value="">No screens</option>}{screens.map(s=><option key={s} value={s}>{s==="unknown"?"Unspecified / legacy":s}</option>)}</select></label><label>Device<select aria-label="Heatmap device" disabled={!contexts.length||loading} value={chosen?.device||""} onChange={e=>choose({surface:chosen?.surface,screen:chosen?.screen,device:e.target.value as HeatmapContext["device"]})}>{!devices.length&&<option value="">No devices</option>}{devices.map(s=><option key={s} value={s}>{s}</option>)}</select></label><label className="pointer-session">Session<select aria-label="Heatmap session" disabled={loading} value={sessionId} onChange={e=>{onClearEvidence();setSessionId(e.target.value);setContext(undefined);}}><option value="">All human sessions</option>{(data?.recentSessions||[]).map(s=><option key={s.id} value={s.id}>{when(s.startedAt)} · {s.device} · {s.id.slice(0,7)}</option>)}</select></label></div>
      {error ? <div className="data-empty heatmap-empty" role="alert"><strong>Coordinates unavailable</strong><p>{error}</p><button className="text-action" onClick={()=>setRetry(x=>x+1)}><RefreshCw size={13}/> Retry</button></div> : <>
        <div className="pointer-map-wrap"><span className="pointer-y-label">Top → bottom</span><div className="pointer-map" role="group" aria-label="Normalized pointer heatmap">
          <svg viewBox="0 0 400 280" aria-hidden="true" preserveAspectRatio="none"><defs><pattern id={mapId} width="20" height="14" patternUnits="userSpaceOnUse"><path d="M 20 0 L 0 0 0 14" fill="none" stroke="#dbe4de" strokeWidth=".7"/></pattern></defs><rect width="400" height="280" fill={`url(#${mapId})`}/></svg>
          {!loading&&(data?.bins||[]).map(bin=><button key={`${bin.bx}:${bin.by}`} type="button" className="pointer-bin" aria-label={`${bin.count} pointer samples at ${bin.bx*5} to ${(bin.bx+1)*5}% across, ${bin.by*5} to ${(bin.by+1)*5}% down`} title={`${bin.count} pointer samples`} style={{left:`${bin.bx*5}%`,top:`${bin.by*5}%`,backgroundColor:`rgba(39, 112, 71, ${0.18+0.82*bin.count/peak})`}} onMouseEnter={()=>setFocused(bin)} onFocus={()=>setFocused(bin)} onClick={()=>{setFocused(bin);if(chosen)onBin(chosen,bin.bx,bin.by,sessionId||undefined);}}/>)}
          {loading ? <div className="pointer-overlay"><LoaderCircle className="spin" size={20}/><span>Loading coordinates…</span></div> : !data?.sampleCount&&<div className="pointer-overlay"><strong>No coordinates in this selection</strong><span>Consent and pointer instrumentation are required.</span><button className="text-action" onClick={onSetup}>SDK setup <ArrowRight size={13}/></button></div>}
        </div><div className="pointer-x-label"><span>0%</span><span>Left → right</span><span>100%</span></div></div>
        <div className="pointer-scale"><span>Fewer samples</span><i/><strong>{count(data?.sampleCount ? peak : 0)}</strong><span>in the busiest bin</span></div>
        <div className="pointer-counts"><strong>{loading ? "…" : count(data?.sampleCount)} samples</strong><span>{loading ? "…" : count(data?.coordinateSessions)} contributing sessions</span></div>
        {focused&&<div className="pointer-inspection" role="status"><strong>{focused.count} samples</strong><span>X {focused.bx*5}–{(focused.bx+1)*5}% · Y {focused.by*5}–{(focused.by+1)*5}%</span><small>Supporting sessions open below.</small></div>}
        <p className="quiet-help">{chosen?.surface==="game"?"Coordinates are relative to the instrumented game surface.":"Coordinates are relative to the browser viewport, including areas outside the game."} This is a coordinate plot, not a screenshot. Samples are not click counts.</p>
        <p className="quiet-help">{loading ? "…" : count(data?.eligibleSessions)} human sessions in the selected game/date{sessionId?"/session":""} scope. {data&&data.recentSessionsTotal>data.recentSessions.length?`The session selector lists the latest ${data.recentSessions.length} of ${data.recentSessionsTotal}.`:""}</p>
      </>}
    </>}
  </section>;
}
