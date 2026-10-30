"use client";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { DEFAULT_VIDEO_SETTINGS, type ContentIdea, type StudioSnapshot, type VideoProduction, type VideoSettings, type PilotReview } from "@/lib/content-studio-contract";
import DailyContentConsent from "./daily-content-consent";
import ContentGenerator from "./content-generator";
import ContentReferenceLibrary from "./content-reference-library";
import ContentScriptEditor from "./content-script-editor";
import type { Game } from "@/lib/types";
import { browserRead } from "@/lib/browser-read";
import InfoHint from "./info-hint";
import { dashboardRequestId, clearDashboardRequest } from "@/lib/dashboard-request";


export default function ContentStudio({ games, gameId, demo, calendarOnly = false }: { games: Game[]; gameId: string; demo: boolean; calendarOnly?: boolean }) {
  const [data, setData] = useState<StudioSnapshot | null>(null);
  const [error, setError] = useState(""); const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false); const lock = useRef(false);
  const [chosen, setChosen] = useState<ContentIdea | null>(null);
  const [settings, setSettings] = useState<VideoSettings>(DEFAULT_VIDEO_SETTINGS);
  const [budget, setBudget] = useState(100); const [acknowledge, setAcknowledge] = useState(false);
  const [focusRunId,setFocusRunId]=useState<string|null>(null);
  const [scriptReady, setScriptReady] = useState(false);
  const [scriptSaved, setScriptSaved] = useState(false);
  const [editorStep, setEditorStep] = useState<1 | 2 | 3>(1);
  useEffect(() => { if (editorStep === 3 && !scriptReady) setEditorStep(2); }, [editorStep, scriptReady]);
  const [pilotReview, setPilotReview] = useState<PilotReview | null>(null);
  const [pilotAck, setPilotAck] = useState(false);
  const requestId = useRef<string | null>(null);
  const approvalPanel = useRef<HTMLFormElement>(null);
  const ideaHeading = useRef<HTMLHeadingElement>(null);
  const currentGame = useRef(gameId); currentGame.current = gameId;
  const [readAttempt,setReadAttempt]=useState(0);
  useEffect(()=>{if(chosen){approvalPanel.current?.focus();approvalPanel.current?.scrollIntoView({block:"start"});}},[chosen]);
  useEffect(() => { setPilotReview(null); setPilotAck(false); setAcknowledge(false); requestId.current = null; }, [chosen, settings, budget, scriptReady]);
  const refresh = useCallback(async () => {
    const body = await browserRead<StudioSnapshot>(`/api/content-studio${gameId === "all" ? "" : `?gameId=${encodeURIComponent(gameId)}`}`);
    if(currentGame.current===gameId)setData(body);
    return body;
  }, [gameId]);
  const generated = useCallback(async (ids:string[]) => {
    const snapshot=await refresh();const idea=snapshot.ideas.find(item=>ids.includes(item.id));
    if(idea){setChosen(idea);setEditorStep(1);setScriptReady(false);setScriptSaved(false);}
  },[refresh]);
  useEffect(() => {
    let cancelled = false; const controller=new AbortController(); setData(null); setChosen(null); setError("");
    if (!demo) void browserRead<StudioSnapshot>(`/api/content-studio${gameId === "all" ? "" : `?gameId=${encodeURIComponent(gameId)}`}`,controller.signal).then(body => {
      if (!cancelled) setData(body);
    }).catch(error => { if (!cancelled) setError(error.message); });
    return () => { cancelled = true; controller.abort(); };
  }, [gameId, demo,readAttempt]);
  useEffect(() => { if (scriptReady) void refresh().catch(() => setNotice("Refresh the studio to load the current script approval.")); }, [scriptReady, refresh]);
  const hasActiveRun = !!data?.productions.some(p => !["ready", "failed", "cancelled"].includes(p.state));
  useEffect(() => {
    if (demo || !hasActiveRun) return;
    let stopped = false; let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      if (!stopped && !document.hidden && !lock.current) {
        try { await refresh(); }
        catch { if (!stopped) setNotice("Status update delayed. Your run continues in the cloud."); }
      }
      if (!stopped) timer = setTimeout(poll, 10000);
    };
    timer = setTimeout(poll, 3000);
    return () => { stopped = true; clearTimeout(timer); };
  }, [demo, hasActiveRun, refresh]);
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
    event.preventDefault(); if (editorStep !== 3 || !chosen || lock.current || !acknowledge || !scriptReady || !data?.readiness.ready) return;
    lock.current = true; setBusy(true); setError("");
    const script = data.scripts?.find(s => s.ideaId === chosen.id);
    const receiptKey = `blaze:video:${chosen.id}:${script?.revision}:${script?.reviewId}:${data.readiness.providerRevision}:${JSON.stringify(settings)}:${budget}`;
    const id = dashboardRequestId(receiptKey, requestId);
    try {
      const production: VideoProduction = await send({ action: "generate", providerRevision: data.readiness.providerRevision, ideaId: chosen.id, scriptRevision: script?.revision, scriptReviewId: script?.reviewId, settings, maxListCostCents: budget, requestId: id, acknowledgeCost: true });
      if (["ready", "failed", "cancelled"].includes(production.state)) clearDashboardRequest(receiptKey);
      setChosen(null); requestId.current = null; setAcknowledge(false); setFocusRunId(production.id); await refresh();
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
  useEffect(()=>{if(!focusRunId||!data?.productions.some(run=>run.id===focusRunId))return;const element=document.getElementById(`studio-run-${focusRunId}`);if(element){element.focus();element.scrollIntoView({block:"start"});setFocusRunId(null);}},[focusRunId,data]);
  useEffect(() => { if (!data?.readiness.ready) setAcknowledge(false); }, [data?.readiness.ready]);
  if (demo) return <section className="content-engine"><p>Sign in to prepare ideas and produce videos for your games.</p></section>;
  const refreshSetup = async () => {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError("");
    try { await refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : "Unable to refresh generation setup."); }
    finally { lock.current = false; setBusy(false); }
  };
  const title = (id: string) => games.find(g => g.id === id)?.title || "Game";
  const ideaPriority = (idea: ContentIdea) => { const script = data?.scripts?.find(s=>s.ideaId===idea.id); return script?.score ? 2 : script ? 1 : 0; };
  const ideas = [...(data?.ideas || [])].sort((a,b)=>ideaPriority(b)-ideaPriority(a));
  const pendingIdeas = ideas.filter(idea => !data?.scripts?.find(script=>script.ideaId===idea.id)?.score);
  const readyIdeas = ideas.filter(idea => !pendingIdeas.some(p=>p.id===idea.id));
  const videos = (data?.productions || []).filter(p => !calendarOnly || p.plannedDate).sort((a, b) => (a.plannedDate || "").localeCompare(b.plannedDate || ""));
  return <section className="content-engine" aria-label={calendarOnly ? "Video planning calendar" : "Gameplay video studio"}>
    {error && <div className="studio-error"><p role="alert">{error}</p>{!data&&<button className="button" onClick={()=>setReadAttempt(n=>n+1)}>Retry loading studio</button>}</div>}
    {notice && <p role="status">{notice}</p>}
    {!data && !error && <p role="status">Loading video studio…</p>}
    {!calendarOnly && data && <>
      <header className="studio-heading"><div><h2 ref={ideaHeading} tabIndex={-1}>Gameplay videos <InfoHint label="About source outlines">Source outlines use saved game facts without an AI charge. Generate game-specific ideas and scripts, choose a suggestion, review its score, then approve a video.</InfoHint></h2><ol className="studio-step-list" aria-label="Video workflow"><li>Script</li><li>Script review</li><li>Video</li></ol></div>
        <ContentGenerator gameId={gameId} onGenerated={generated}/></header>
      {gameId === "all" && <p className="studio-hint">Choose one game above to prepare its ideas.</p>}
      <div className="studio-tools">
      <details className="studio-setup"><summary>{data.readiness.ready ? "Video · Ready" : "Video · Setup required"}</summary>
        {data.readiness.connectionLabel && <p>Saved Anthropic connection: {data.readiness.connectionLabel}</p>}
        <ul>{data.readiness.reasons.map(reason => <li key={reason}>{reason}</li>)}</ul>
        <p>The agent must play and capture the actual game in the cloud. No video has been generated until an accepted MP4 appears below.</p>
      </details>
      <details className="studio-schedule"><summary>Daily suggestions · {data.schedule.enabled ? "Active" : "Paused"}</summary>
        <form className="studio-schedule-form" onSubmit={event => { event.preventDefault(); const form = new FormData(event.currentTarget); void act({ action: "save_schedule", schedule: { countPerGame: Number(form.get("count")), localTime: form.get("time") || null, maxOutputTokensPerGame: data.schedule.maxOutputTokensPerGame } }); }}>
          <label>Ideas per game<select name="count" defaultValue={data.schedule.countPerGame}><option value="2">2</option><option value="3">3</option></select></label>
          <label>Daily time · Dubai<input type="time" name="time" defaultValue={data.schedule.localTime || ""}/></label>
          <button className="button" disabled={busy}>Save preferences</button>
        </form><DailyContentConsent enabled={data.schedule.enabled} onChanged={refresh}/>{data.dailyPlan?.needsReview&&<p role="status">Daily consent expired or changed. Review the plan to continue.</p>}{data.schedule.enabled&&data.dailyPlan?.expiresAt&&<small>Approved until {new Date(data.dailyPlan.expiresAt).toLocaleDateString("en-GB",{timeZone:"Asia/Dubai"})}</small>}
      </details>
      <details><summary>Source outlines · no AI charge</summary><button type="button" className="button" disabled={busy || gameId === "all"} onClick={()=>void act({action:"prepare_outlines",gameId})}>Prepare source outlines</button></details>
      <ContentReferenceLibrary selected={data.references?.selected} revision={data.references?.revision}/>
      </div>
      {!chosen&&<div className="studio-ideas">{readyIdeas.map(idea => { const saved = data.scripts?.find(s=>s.ideaId===idea.id); const shownScore = saved?.score || saved?.staleScore; const facts=data.sourceFacts?.find(s=>s.gameId===idea.gameId&&s.sourceRevision===idea.sourceRevision)?.facts.filter(f=>idea.factKeys.includes(f.key)); return <article className="studio-idea" key={idea.id} onClick={event=>{if((event.target as HTMLElement).closest("button,a,details,input,select,textarea"))return;setChosen(idea);setEditorStep(1);setScriptReady(false);setScriptSaved(false);}}>
        <div><small>{title(idea.gameId)} · {idea.origin === "daily_agent" ? "Daily suggestion" : idea.origin === "on_demand_agent" ? "Generated suggestion" : "Source outline · no AI run"}</small><h3>{idea.title}</h3><p>{idea.hook}</p>
          <details><summary>Shots and source facts</summary><p>{idea.treatment}</p><ol>{idea.shots.map(shot => <li key={shot}>{shot}</li>)}</ol>{facts?.length?<ul className="studio-source-facts">{facts.map(f=><li key={f.key}>{f.value}</li>)}</ul>:<p>Current source evidence is unavailable for this outline. Prepare fresh outlines after reviewing the game source.</p>}</details></div>
        <div className="studio-idea-action">{shownScore ? <span className="studio-score-summary"><strong>{shownScore.overall}/100</strong><span>{saved?.staleScore ? "Earlier score" : "Content score"}</span><InfoHint label="About this score">{saved?.staleScore ? "Historical score. Open the script to inspect the earlier review; it does not authorize production." : "A creative review, not a prediction of virality."}</InfoHint></span> : <span className="studio-secondary">{saved?.sourceStale ? "Source changed" : "Not scored"}</span>}
        <button className="button" disabled={busy} onClick={() => { setChosen(idea); setEditorStep(1); setScriptReady(false); setScriptSaved(false); setSettings(DEFAULT_VIDEO_SETTINGS); setAcknowledge(false); requestId.current = null; }}>Open script</button>{!saved?.score&&<button type="button" className="button" disabled={busy || !saved || saved.sourceStale} onClick={()=>{setChosen(idea);setEditorStep(2);setScriptReady(false);setScriptSaved(false);}}>Score content</button>}<button type="button" className="button" disabled={busy} onClick={()=>void act({action:"reject",ideaId:idea.id})}>I don’t like this</button></div>
      </article>; })}</div>}
      {!!pendingIdeas.length&&<section className="studio-pending" aria-label="Pending suggestions"><h3>Drafts and in progress · {pendingIdeas.length}</h3>{pendingIdeas.map(idea=><div key={idea.id}><strong>{idea.title}</strong><span role="status">{idea.origin === "source_outline" ? "Draft · not scored" : data.scripts?.find(script=>script.ideaId===idea.id)?.reviewState === "failed" || data.scripts?.find(script=>script.ideaId===idea.id)?.reviewState === "needs_reconciliation" ? "Review needs attention" : "Awaiting current score"}</span><button type="button" className="button" onClick={()=>{setChosen(idea);setEditorStep(1);setScriptReady(false);setScriptSaved(false);}}>Inspect script</button><button type="button" className="button" disabled={busy} onClick={()=>void act({action:"reject",ideaId:idea.id})}>I don’t like this</button></div>)}</section>}
      {!data.ideas.length && <p className="studio-empty">No suggestions yet. Choose a game and generate ideas and scripts.</p>}
      {!!data.rejections?.length&&<details className="studio-rejection-history"><summary>Not for me · {data.rejections.length}</summary><ul>{data.rejections.map(item=><li key={item.id}><strong>{item.title}</strong><span>{new Date(item.rejectedAt).toLocaleDateString("en-GB",{timeZone:"Asia/Dubai"})}</span>{item.reason&&<p>{item.reason}</p>}</li>)}</ul><small>Used as context for future suggestions. This is saved feedback, not model training.</small></details>}
      {chosen && <form ref={approvalPanel} tabIndex={-1} className="studio-approval" onSubmit={approve} aria-label="Video settings and approval">
        <div className="studio-heading"><div><small>{title(chosen.gameId)}</small><h3>{chosen.title}</h3></div><button type="button" className="button" disabled={busy} onClick={() => { setChosen(null); ideaHeading.current?.focus(); void refresh().catch(e=>setError(e.message)); }}>Close settings</button></div>
        <nav className="studio-editor-steps" aria-label="Production steps">{(["Script", "Script review", "Video"] as const).map((label, index) => <button type="button" key={label} aria-current={editorStep === index + 1 ? "step" : undefined} disabled={index === 2 && !scriptReady} aria-describedby={index === 2 && !scriptReady ? "video-step-blocked" : undefined} onClick={() => setEditorStep((index + 1) as 1 | 2 | 3)}><span>{index + 1}</span>{label}</button>)}</nav>
        <div hidden={editorStep === 3} className="studio-editor-section"><ContentScriptEditor key={chosen.id} ideaId={chosen.id} onReady={setScriptReady} onScriptReady={setScriptSaved} step={editorStep === 1 ? "script" : "review"}/></div>
        {editorStep < 3 && <div className="studio-step-actions"><button type="button" className="button primary" disabled={busy || (editorStep === 1 ? !scriptSaved : !scriptReady)} onClick={() => setEditorStep(editorStep === 1 ? 2 : 3)}>{editorStep === 1 ? "Continue to review" : "Continue to video"}</button></div>}
        {!scriptReady && <p id="video-step-blocked" className="studio-secondary" role="status">{editorStep === 1 && !scriptSaved ? "Save the current script before continuing." : "Complete a successful review of this saved script to continue to video."}</p>}
        <section hidden={editorStep !== 3} className="studio-editor-section">
        <h4>Video settings</h4>
        <div className="studio-settings">
          <label>Aspect ratio<select value={settings.aspectRatio} onChange={e => { requestId.current = null; setSettings({ ...settings, aspectRatio: e.target.value as VideoSettings["aspectRatio"] }); }}><option>9:16</option><option>16:9</option><option>1:1</option></select></label>
          <label>Duration · seconds<input type="number" min="10" max="60" value={settings.durationSeconds} onChange={e => { requestId.current = null; setSettings({ ...settings, durationSeconds: Number(e.target.value) }); }}/></label>
          <label>Captions<select value={settings.captions} onChange={e => { requestId.current = null; setSettings({ ...settings, captions: e.target.value as VideoSettings["captions"] }); }}><option value="minimal">Minimal</option><option value="full">Full</option><option value="none">None</option></select></label>
          <label>Music<select value={settings.music} onChange={e => { requestId.current = null; setSettings({ ...settings, music: e.target.value as VideoSettings["music"] }); }}><option value="quiet_generated">Quiet generated music</option><option value="none">None</option></select></label>
          <label>Session list-cost threshold · USD cents<input type="number" min="1" max="5000" value={budget} onChange={e => { requestId.current = null; setBudget(Number(e.target.value)); }}/></label>
        </div>
        <label className="studio-check"><input type="checkbox" checked={settings.motionGraphics} onChange={e => setSettings({ ...settings, motionGraphics: e.target.checked })}/>Motion graphics</label>
        <label className="studio-check"><input type="checkbox" checked={settings.gameAudio} onChange={e => setSettings({ ...settings, gameAudio: e.target.checked })}/>Require captured game audio</label>
        {!scriptReady && <p role="status">A current saved script and script review are required before approval.</p>}
        <p>Claude checks the threshold between model requests; the final request can exceed it. Existing credits depend on the key's organization and eligibility. Storage costs are separate. No automatic retry.</p>
        <label className="studio-check"><input type="checkbox" required disabled={busy || !scriptReady || !data.readiness.ready} checked={acknowledge} onChange={e => setAcknowledge(e.target.checked)}/>I approve this idea, these settings and one metered cloud production attempt.</label>
        <button className="button primary" disabled={busy || !acknowledge || !scriptReady || !data.readiness.ready}>{busy ? "Starting…" : "Generate video"}</button>
        {!data.readiness.ready && <div className="studio-generation-blockers" role="status"><strong>Before generation</strong><ul>{data.readiness.reasons.length ? data.readiness.reasons.map(reason => <li key={reason}>{reason}</li>) : <li>Setup status is unavailable. Refresh it before approving generation.</li>}</ul><button type="button" className="button" disabled={busy} onClick={() => void refreshSetup()}>Refresh setup status</button></div>}
        {data.pilot?.operator && <div className="studio-pilot"><h4>Single-use operator pilot</h4><p>Only this reviewed script, game and provider configuration can be used. This does not enable normal generation or recurrence.</p><button type="button" className="button" disabled={busy || !scriptReady} onClick={() => void pilot(false)}>Inspect exact pilot approval</button>
          {pilotReview && <><p>{pilotReview.settings.durationSeconds}s · {pilotReview.settings.aspectRatio} · threshold ${(pilotReview.maxListCostCents / 100).toFixed(2)} (may overshoot; no hard total spending cap)</p><p>Agent {pilotReview.provider.agentId} v{pilotReview.provider.agentVersion} · environment {pilotReview.provider.environmentId}</p><small>Source revision {pilotReview.sourceRevision}</small><ul>{pilotReview.reasons.map(x => <li key={x}>{x}</li>)}</ul><label className="studio-check"><input type="checkbox" checked={pilotAck} onChange={e => setPilotAck(e.target.checked)}/>I approve this exact script, settings and one cloud pilot attempt. No retry or resume.</label><button type="button" className="button" disabled={busy || !pilotAck || !pilotReview.ready || !scriptReady} onClick={() => void pilot(true)}>Approve one pilot · start separately</button></>}
        </div>}
        </section>
      </form>}
    </>}
    {data && <div className="studio-videos"><h3>{calendarOnly ? "Videos planned for manual posting · Dubai" : "Video runs"}</h3>
      {!videos.length && <p className="studio-secondary">{calendarOnly ? "Add a planning date to a finished video in Content Studio." : "Approved runs and finished videos will appear here."}</p>}
      {videos.map(video => <article className="studio-video" key={video.id} id={`studio-run-${video.id}`} tabIndex={-1}>
        <header><div><small>{title(video.gameId)}{video.pilotGrantId ? " · single-use pilot" : ""}</small><h4>{video.idea.title}</h4></div><span role="status">{({approved:"Approved · waiting to start",starting:"Starting cloud session",running:"Playing and editing",importing:"Saving video",cancel_requested:"Stopping",needs_reconciliation:"Needs attention",failed:"Failed",cancelled:"Cancelled",ready:"Ready"})[video.state]}</span></header>
        <p>{video.settings.aspectRatio} · {video.settings.durationSeconds}s · list-cost threshold ${(video.maxListCostCents / 100).toFixed(2)} · {video.usage?.listCostCents ? `Reported list cost $${(Number(video.usage.listCostCents) / 100).toFixed(2)} · unsettled` : "Actual cost unavailable"}</p>
        {video.usage?.inputTokens !== undefined && <small>{video.usage.inputTokens.toLocaleString()} input tokens · {(video.usage.outputTokens || 0).toLocaleString()} output tokens. Credits and final billing may differ from list cost.</small>}
        {video.error && <p role="status">{video.error}</p>}
        {["starting", "running", "importing", "cancel_requested"].includes(video.state) && <p className="studio-secondary">Updates automatically. You can leave this page.</p>}
        {video.state === "needs_reconciliation" && <p className="studio-secondary">The last outcome is uncertain. Status checks are safe; another generation request is blocked until this attempt is reconciled.</p>}
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
