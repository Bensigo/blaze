"use client";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { DEFAULT_VIDEO_SETTINGS, type ContentIdea, type StudioSnapshot, type VideoProduction, type VideoSettings, type PilotReview } from "@/lib/content-studio-contract";
import ScriptReviewScore from "./script-review-score";
import ContentScriptEditor from "./content-script-editor";
import type { Game } from "@/lib/types";
import "./content-studio.css";

export default function ContentStudio({ games, gameId, demo, calendarOnly = false }: { games: Game[]; gameId: string; demo: boolean; calendarOnly?: boolean }) {
  const [data, setData] = useState<StudioSnapshot | null>(null);
  const [error, setError] = useState(""); const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false); const lock = useRef(false);
  const [chosen, setChosen] = useState<ContentIdea | null>(null);
  const [settings, setSettings] = useState<VideoSettings>(DEFAULT_VIDEO_SETTINGS);
  const [budget, setBudget] = useState(100); const [acknowledge, setAcknowledge] = useState(false);
  const [scriptReady, setScriptReady] = useState(false);
  const [pilotReview, setPilotReview] = useState<PilotReview | null>(null);
  const [pilotAck, setPilotAck] = useState(false);
  const requestId = useRef<string | null>(null);
  useEffect(() => { setPilotReview(null); setPilotAck(false); setAcknowledge(false); requestId.current = null; }, [chosen, settings, budget, scriptReady]);
  const refresh = useCallback(async () => {
    const response = await fetch(`/api/content-studio${gameId === "all" ? "" : `?gameId=${encodeURIComponent(gameId)}`}`, { cache: "no-store" });
    const body = await response.json(); if (!response.ok) throw new Error(body.error || "Unable to load Content Studio.");
    setData(body);
  }, [gameId]);
  useEffect(() => {
    let cancelled = false; setData(null); setChosen(null); setError("");
    if (!demo) void fetch(`/api/content-studio${gameId === "all" ? "" : `?gameId=${encodeURIComponent(gameId)}`}`, { cache: "no-store" }).then(async response => {
      const body = await response.json(); if (!response.ok) throw new Error(body.error || "Unable to load Content Studio."); if (!cancelled) setData(body);
    }).catch(error => { if (!cancelled) setError(error.message); });
    return () => { cancelled = true; };
  }, [gameId, demo]);
  const send = async (body: Record<string, unknown>) => {
    const response = await fetch("/api/content-studio", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const result = await response.json(); if (!response.ok) throw new Error(result.error || "The request did not complete."); return result.result;
  };
  const act = async (body: Record<string, unknown>) => {
    if (lock.current) return; lock.current = true; setBusy(true); setError(""); setNotice("");
    try { await send(body); await refresh(); }
    catch (error) { setError(error instanceof Error ? error.message : "The request did not complete."); }
    finally { lock.current = false; setBusy(false); }
  };
  const approve = async (event: FormEvent) => {
    event.preventDefault(); if (!chosen || lock.current || !acknowledge) return;
    lock.current = true; setBusy(true); setError("");
    requestId.current ||= crypto.randomUUID();
    try {
      const production: VideoProduction = await send({ action: "approve", ideaId: chosen.id, settings, maxListCostCents: budget, requestId: requestId.current, acknowledgeCost: true });
      // Start once. Network errors keep the same request ID and recoverable approved record.
      if (production.state === "approved") await send({ action: "start", productionId: production.id });
      setChosen(null); requestId.current = null; setAcknowledge(false); await refresh();
    } catch (error) { setError(error instanceof Error ? error.message : "Unable to start this video. Refresh to inspect its state before trying again."); await refresh().catch(() => {}); }
    finally { lock.current = false; setBusy(false); }
  };
  const pilotSend = async (body: Record<string, unknown>) => {
    const r = await fetch("/api/content-studio/pilot", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const b = await r.json(); if (!r.ok) throw Error(b.error || "Pilot request did not complete."); return b.result;
  };
  const pilot = async (approve: boolean) => {
    if (!chosen || lock.current) return; lock.current = true; setBusy(true); setError("");
    try {
      const inputs = { ideaId: chosen.id, settings, maxListCostCents: budget };
      if (!approve) setPilotReview(await pilotSend({ action: "review", ...inputs }));
      else {
        if (!pilotReview || !pilotAck) return; requestId.current ||= crypto.randomUUID();
        await pilotSend({ action: "approve", ...inputs, reviewHash: pilotReview.reviewHash, requestId: requestId.current, acknowledgeCost: true, confirm: "Approve one cloud gameplay pilot" });
        setChosen(null); setPilotReview(null); setPilotAck(false); await refresh();
      }
    } catch (e) { setError(e instanceof Error ? e.message : "Pilot request failed."); await refresh().catch(() => {}); }
    finally { lock.current = false; setBusy(false); }
  };
  if (demo) return <section className="content-engine"><p>Sign in to prepare ideas and produce videos for your games.</p></section>;
  const title = (id: string) => games.find(g => g.id === id)?.title || "Game";
  const ideaPriority = (idea: ContentIdea) => { const script = data?.scripts?.find(s=>s.ideaId===idea.id); return script?.score ? 2 : script ? 1 : 0; };
  const ideas = [...(data?.ideas || [])].sort((a,b)=>ideaPriority(b)-ideaPriority(a));
  const videos = (data?.productions || []).filter(p => !calendarOnly || p.plannedDate).sort((a, b) => (a.plannedDate || "").localeCompare(b.plannedDate || ""));
  return <section className="content-engine" aria-label={calendarOnly ? "Video planning calendar" : "Gameplay video studio"}>
    {error && <p role="alert" className="studio-error">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    {!data && !error && <p role="status">Loading video studio…</p>}
    {!calendarOnly && data && <>
      <header className="studio-heading"><div><h2>Gameplay videos</h2><p>Choose an idea. Approve its settings. Review and download the finished video.</p></div>
        <button className="button" disabled={busy || !games.length || gameId === "all"} onClick={() => void act({ action: "prepare_outlines", gameId })}>Prepare source outlines</button></header>
      {gameId === "all" && <p className="studio-hint">Choose one game above to prepare its ideas.</p>}
      <details className="studio-setup"><summary>Cloud producer · {data.readiness.ready ? "Ready" : "Setup pending"}</summary>
        {data.readiness.connectionLabel && <p>Saved Anthropic connection: {data.readiness.connectionLabel}</p>}
        <ul>{data.readiness.reasons.map(reason => <li key={reason}>{reason}</li>)}</ul>
        <p>The agent must play and capture the actual game in the cloud. No video has been generated until an accepted MP4 appears below.</p>
      </details>
      <details className="studio-schedule"><summary>Daily idea agent · {data.schedule.enabled ? "Enabled" : "Paused"} · {data.schedule.countPerGame} ideas per game</summary>
        <form className="studio-schedule-form" onSubmit={event => { event.preventDefault(); const form = new FormData(event.currentTarget); void act({ action: "save_schedule", schedule: { countPerGame: Number(form.get("count")), localTime: form.get("time") || null, maxOutputTokensPerGame: data.schedule.maxOutputTokensPerGame } }); }}>
          <label>Ideas per game<select name="count" defaultValue={data.schedule.countPerGame}><option value="2">2</option><option value="3">3</option></select></label>
          <label>Daily time · Dubai<input type="time" name="time" defaultValue={data.schedule.localTime || ""}/></label>
          <button className="button" disabled={busy}>Save preferences</button>
        </form><p>Source outlines are free preparation. Daily AI ideas stay paused until the account, budget and schedule are approved.</p>
      </details>
      <div className="studio-ideas">{ideas.map(idea => { const saved = data.scripts?.find(s=>s.ideaId===idea.id); const shownScore = saved?.score || saved?.staleScore; return <article className="studio-idea" key={idea.id}>
        <div><small>{title(idea.gameId)} · {idea.origin === "daily_agent" ? "Daily AI proposal" : "Source outline · no AI run"}</small><h3>{idea.title}</h3><p>{idea.hook}</p><p className="studio-secondary">{idea.treatment}</p>
          <details><summary>Shots and source facts</summary><ol>{idea.shots.map(shot => <li key={shot}>{shot}</li>)}</ol><p>Facts: {idea.factKeys.join(", ")}</p></details></div>
        {saved && <div className="studio-saved-script"><details><summary>Saved script</summary><p style={{whiteSpace:"pre-wrap"}}>{saved.text}</p></details>{shownScore ? <ScriptReviewScore score={shownScore} stale={saved.sourceStale}/> : <p role="status">{saved.sourceStale ? "Source changed · earlier script and score are stale. Prepare fresh source outlines." : `Jev review: ${saved.reviewState || "not requested"}`}</p>}</div>}
        <button className="button" disabled={busy} onClick={() => { setChosen(idea); setScriptReady(false); setSettings(DEFAULT_VIDEO_SETTINGS); setAcknowledge(false); requestId.current = null; }}>Review script &amp; video settings</button>
      </article>; })}</div>
      {!data.ideas.length && <p className="studio-empty">No ideas yet. Select a game and prepare source outlines while the daily agent is being connected.</p>}
      {chosen && <form className="studio-approval" onSubmit={approve} aria-label="Video settings and approval">
        <div className="studio-heading"><h3>{chosen.title}</h3><button type="button" className="button" disabled={busy} onClick={() => { setChosen(null); void refresh(); }}>Close settings</button></div>
        <ContentScriptEditor key={chosen.id} ideaId={chosen.id} onReady={setScriptReady}/>
        <h4>3. Approve the reviewed script and video settings</h4>
        <div className="studio-settings">
          <label>Aspect ratio<select value={settings.aspectRatio} onChange={e => { requestId.current = null; setSettings({ ...settings, aspectRatio: e.target.value as VideoSettings["aspectRatio"] }); }}><option>9:16</option><option>16:9</option><option>1:1</option></select></label>
          <label>Duration · seconds<input type="number" min="10" max="60" value={settings.durationSeconds} onChange={e => { requestId.current = null; setSettings({ ...settings, durationSeconds: Number(e.target.value) }); }}/></label>
          <label>Captions<select value={settings.captions} onChange={e => { requestId.current = null; setSettings({ ...settings, captions: e.target.value as VideoSettings["captions"] }); }}><option value="minimal">Minimal</option><option value="full">Full</option><option value="none">None</option></select></label>
          <label>Music<select value={settings.music} onChange={e => { requestId.current = null; setSettings({ ...settings, music: e.target.value as VideoSettings["music"] }); }}><option value="quiet_generated">Quiet generated music</option><option value="none">None</option></select></label>
          <label>Session list-cost threshold · USD cents<input type="number" min="1" max="5000" value={budget} onChange={e => { requestId.current = null; setBudget(Number(e.target.value)); }}/></label>
        </div>
        <label className="studio-check"><input type="checkbox" checked={settings.motionGraphics} onChange={e => setSettings({ ...settings, motionGraphics: e.target.checked })}/>Motion graphics</label>
        <label className="studio-check"><input type="checkbox" checked={settings.gameAudio} onChange={e => setSettings({ ...settings, gameAudio: e.target.checked })}/>Require captured game audio</label>
        <p>Claude checks the threshold between model requests; the final request can exceed it. Existing credits depend on the key's organization and eligibility. Storage costs are separate. No automatic retry.</p>
        <label className="studio-check"><input type="checkbox" required checked={acknowledge} onChange={e => setAcknowledge(e.target.checked)}/>I approve this idea, these settings and one metered cloud production attempt.</label>
        <button className="button primary" disabled={busy || !acknowledge || !scriptReady || !data.readiness.ready}>{busy ? "Saving…" : "Approve & generate video"}</button>
        {!data.readiness.ready && <p role="status">Generation is unavailable until the setup items above are complete.</p>}
        {data.pilot?.operator && <div className="studio-pilot"><h4>Single-use operator pilot</h4><p>Only this reviewed script, game and provider configuration can be used. This does not enable normal generation or recurrence.</p><button type="button" className="button" disabled={busy || !scriptReady} onClick={() => void pilot(false)}>Inspect exact pilot approval</button>
          {pilotReview && <><p>{pilotReview.settings.durationSeconds}s · {pilotReview.settings.aspectRatio} · threshold ${(pilotReview.maxListCostCents / 100).toFixed(2)} (may overshoot; no hard total spending cap)</p><p>Agent {pilotReview.provider.agentId} v{pilotReview.provider.agentVersion} · environment {pilotReview.provider.environmentId}</p><small>Source revision {pilotReview.sourceRevision}</small><ul>{pilotReview.reasons.map(x => <li key={x}>{x}</li>)}</ul><label className="studio-check"><input type="checkbox" checked={pilotAck} onChange={e => setPilotAck(e.target.checked)}/>I approve this exact script, settings and one cloud pilot attempt. No retry or resume.</label><button type="button" className="button" disabled={busy || !pilotAck || !pilotReview.ready || !scriptReady} onClick={() => void pilot(true)}>Approve one pilot · start separately</button></>}
        </div>}
      </form>}
    </>}
    {data && <div className="studio-videos"><h3>{calendarOnly ? "Videos planned for manual posting · Dubai" : "Video runs"}</h3>
      {!videos.length && <p className="studio-secondary">{calendarOnly ? "Add a planning date to a finished video in Content Studio." : "Approved runs and finished videos will appear here."}</p>}
      {videos.map(video => <article className="studio-video" key={video.id}>
        <header><div><small>{title(video.gameId)}{video.pilotGrantId ? " · single-use pilot" : ""}</small><h4>{video.idea.title}</h4></div><span>{video.state.replaceAll("_", " ")}</span></header>
        <p>{video.settings.aspectRatio} · {video.settings.durationSeconds}s · list-cost threshold ${(video.maxListCostCents / 100).toFixed(2)} · {video.usage?.listCostCents ? `Reported list cost $${(Number(video.usage.listCostCents) / 100).toFixed(2)} · unsettled` : "Actual cost unavailable"}</p>
        {video.usage?.inputTokens !== undefined && <small>{video.usage.inputTokens.toLocaleString()} input tokens · {(video.usage.outputTokens || 0).toLocaleString()} output tokens. Credits and final billing may differ from list cost.</small>}
        {video.error && <p role="status">{video.error}</p>}
        {video.state === "ready" && video.videoUrl && <><video controls preload="metadata" playsInline src={video.videoUrl} aria-label={video.idea.title}/><p>Review the footage, captions and claimed results before posting.</p>
          <div className="studio-video-actions"><a className="button" href={`/api/content-studio/${video.id}/download`}>Download MP4</a>
          <label>Planning date · Dubai<input aria-label={`Planning date for ${video.idea.title}`} type="date" value={video.plannedDate || ""} disabled={busy} onChange={e => void act({ action: "plan", productionId: video.id, date: e.target.value || null })}/></label></div>
          <small>Planning only. Download and post manually on X or YouTube.</small></>}
        {video.state === "approved" && <button className="button" disabled={busy} onClick={() => void act({ action: "start", productionId: video.id })}>Start approved attempt</button>}
        {!["ready", "failed", "cancelled"].includes(video.state) && <div className="studio-video-actions"><button className="button" disabled={busy} onClick={() => void act({ action: "refresh", productionId: video.id })}>Refresh status</button><button className="button" disabled={busy || video.state === "cancel_requested"} onClick={() => void act({ action: "cancel", productionId: video.id })}>Cancel</button></div>}
      </article>)}
    </div>}
  </section>;
}
