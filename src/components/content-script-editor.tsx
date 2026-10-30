"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import ScriptReviewScore from "./script-review-score";
import { SCRIPT_RUBRIC } from "@/lib/script-review-rubric";
import type { ContentScript, ScriptReview } from "@/lib/content-scripts";
import { browserRead } from "@/lib/browser-read";
import InfoHint from "./info-hint";
type State = { sourceStale?: boolean;contextStale?:boolean;context?:{referenceSetRevision:string;rubricRevision:string;referenceIds:string[]}|null; script?: ContentScript; review?: ScriptReview; staleReview?: ScriptReview; caveat: string };
type Proposal = { reviewHash: string; scriptRevision: string; model: string; inputBytes: number; questionCount: number; pricing: {inputUsdPerMillion:number;outputUsdPerMillion:number}; costAdmission: {maxCostCents:1;maxCostBoundUsd:number;maxBillableInputTokens:number;requestByteLimit:number}; enabled: boolean };
// In-memory only: retain unsaved drafts across workspace navigation.
// Apply only after an authorized read and only to the same saved revision.
const unsavedDrafts = new Map<string, { revision: string | null; text: string }>();
let unloadGuardAttached = false;
const warnBeforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
function syncDraftGuard() {
  if (typeof window === "undefined") return;
  if (unsavedDrafts.size && !unloadGuardAttached) { window.addEventListener("beforeunload", warnBeforeUnload); unloadGuardAttached = true; }
  if (!unsavedDrafts.size && unloadGuardAttached) { window.removeEventListener("beforeunload", warnBeforeUnload); unloadGuardAttached = false; }
}
function clearDraft(ideaId: string) { unsavedDrafts.delete(ideaId); syncDraftGuard(); }
function restoredText(ideaId: string, state: State) {
  const draft = unsavedDrafts.get(ideaId);
  if (draft && draft.revision === (state.script?.revision || null) && !state.sourceStale) return draft.text;
  clearDraft(ideaId);
  return state.script?.text || "";
}
export default function ContentScriptEditor({ ideaId, onReady, step }: { ideaId: string; onReady: (ready: boolean) => void; step?: "script" | "review" }) {
  const [state, setState] = useState<State | null>(null); const [text, setText] = useState("");
  const [proposal, setProposal] = useState<Proposal | null>(null); const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const lock = useRef(false); const requestId = useRef<string | null>(null);
  const [readAttempt,setReadAttempt]=useState(0);
  const load = useCallback(async () => { const b=await browserRead<State>(`/api/content-studio/scripts?ideaId=${encodeURIComponent(ideaId)}`); setState(b); setText(restoredText(ideaId, b)); return b; }, [ideaId]);
  useEffect(() => { let active = true; const controller=new AbortController();setState(null);setError("");onReady(false); void browserRead<State>(`/api/content-studio/scripts?ideaId=${encodeURIComponent(ideaId)}`,controller.signal).then(b => { if (active) { setState(b); setText(restoredText(ideaId, b)); } }).catch(e => { if (active) setError(e.message); }); return () => { active = false;controller.abort(); }; }, [ideaId, onReady,readAttempt]);
  const expired = state?.review?.state === "approved" && Date.parse(state.review.expiresAt) <= Date.now();
  const dirty = text !== (state?.script?.text || ""); const current = !state?.sourceStale && !state?.contextStale && !dirty && state?.review?.state === "complete" && state.review.scriptRevision === state.script?.revision ? state.review : undefined;
  const shown = current || (dirty && state?.review?.score ? state.review : state?.staleReview);
  useEffect(() => { onReady(!!current?.score); }, [current, onReady]);
  const send = async (body: Record<string, unknown>) => { const r = await fetch("/api/content-studio/scripts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); const b = await r.json(); if (!r.ok) throw Error(b.error || "Script request did not complete."); return b.result; };
  const act = async (body: Record<string, unknown>) => { if (lock.current) return; lock.current = true; setBusy(true); setError(""); try { await send(body); clearDraft(ideaId); setProposal(null); setAck(false); await load(); } catch (e) { setError(e instanceof Error ? e.message : "Request failed."); } finally { lock.current = false; setBusy(false); } };
  const review = async () => {
    if (!proposal || !ack || lock.current) return; lock.current = true; setBusy(true); onReady(false); setError(""); requestId.current ||= crypto.randomUUID();
    try { const grant: ScriptReview = await send({ action: "approve_review", scriptId: state!.script!.id, reviewHash: proposal.reviewHash, requestId: requestId.current, maxCostCents: 1, acknowledgeCost: true }); if (grant.state === "approved") await send({ action: "start_review", reviewId: grant.id }); setProposal(null); setAck(false); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : "Jev request did not complete."); await load().catch(() => {}); }
    finally { lock.current = false; setBusy(false); }
  };
  return <div className="studio-script" aria-label="Script and Jev review">
    {error && <div className="studio-error"><p role="alert">{error}</p>{!state&&<button type="button" className="button" onClick={()=>setReadAttempt(n=>n+1)}>Retry loading script</button>}</div>}
    {!state&&!error&&<p role="status">Loading saved script…</p>}
    <section hidden={step === "review"} className="studio-editor-section">
    <h4>Script <InfoHint label="About script approval">Jev reviews this exact saved version. Editing it invalidates its score and production approval.</InfoHint></h4>
    {state&&!state.script && <button type="button" className="button" disabled={busy} onClick={() => void act({ action: "draft", ideaId })}>Generate source-based draft · no AI charge</button>}
    <label>Your script<textarea aria-label="Video script" disabled={!state||busy} rows={8} maxLength={5000} value={text} onChange={e => { setText(e.target.value); if(e.target.value === (state?.script?.text || "")) clearDraft(ideaId); else { unsavedDrafts.set(ideaId, { revision: state?.script?.revision || null, text: e.target.value }); syncDraftGuard(); } setProposal(null); setAck(false); requestId.current = null; onReady(false); }}/></label>
    <button type="button" className="button" disabled={!state || busy || state?.sourceStale || text.trim().length < 20 || (!dirty&&!state?.contextStale)} onClick={() => void act({ action: "save", ideaId, text, expectedRevision: state?.script?.revision })}>{state?.contextStale?"Save with current references":"Save script"}</button>
    {state?.contextStale&&!state.sourceStale&&<p role="status">References or rubric changed. The earlier score belongs to a prior version. Save this script with current references, then approve a new Jev review. Nothing runs automatically.</p>}
    {state?.sourceStale && <p role="status">Game source changed. This script and its earlier score are stale. Prepare a fresh idea from the new source before review or generation.</p>}
    {dirty && <p role="status">Unsaved changes. The earlier score and video approval do not apply to this draft.</p>}
    </section>
    <section hidden={step === "script"} className="studio-editor-section">
    <h4>Jev score <InfoHint label="How Jev scoring works">Four ratings worth 25 points each. A creative review, not a prediction of virality. Explanations and improvements use the rubric, not generated Jev prose.</InfoHint></h4><details><summary>Scoring rubric</summary><ul>{Object.entries(SCRIPT_RUBRIC).map(([k,r]) => <li key={k}><b>{k}</b><ol start={0}>{r.levels.map(x => <li key={x}>{x}</li>)}</ol></li>)}</ul><p>Each 0–4 rating is scaled and rounded to 0–25 points; the four points totals are added.</p></details>
    {shown?.score ? <div><ScriptReviewScore score={shown.score} stale={!current}/>{!current&&!shown.referenceSetRevision&&<p>This earlier review did not include reference examples.</p>}<small>{shown.model} · {shown.usage?.reportedCostUsd !== undefined ? `Reported OpenRouter cost $${shown.usage.reportedCostUsd}` : "Reported cost unavailable"}</small></div> : <p role="status">{dirty ? "Score stale for this edited draft." : state?.review ? `Review ${state.review.state.replaceAll("_", " ")}. ${state.review.error || "No score is available yet."}` : state?.staleReview ? "Earlier score is stale. Request a review of this script version." : "No Jev score yet."}</p>}
    {state?.context&&<details><summary>Reference and rubric version</summary><p>Examples: {state.context.referenceIds.join(", ")}. Reference revision {state.context.referenceSetRevision.slice(0,12)}. Rubric {state.context.rubricRevision}. Examples are untrusted structural comparisons, never game facts or viral predictions.</p></details>}
    {!current&&state?.review&&<p role="status">Current review: {state.review.state.replaceAll("_"," ")}. {state.review.error||"No current-version score is available."}</p>}
    {expired && <p role="status">The unused Jev approval expired. Inspect and approve a fresh request.</p>}
    {!current && state?.review?.usage?.reportedCostUsd !== undefined && <p>Reported OpenRouter cost ${state.review.usage.reportedCostUsd}. Reconcile any admission violation before another request.</p>}
    {!proposal && <button type="button" className="button" disabled={busy || state?.sourceStale || state?.contextStale || dirty || !state?.script || (!expired && ["approved", "starting", "needs_reconciliation"].includes(state?.review?.state || ""))} onClick={async () => { if (lock.current) return; lock.current = true; setBusy(true); setError(""); try { setProposal(await send({ action: "review_proposal", scriptId: state!.script!.id })); requestId.current = null; } catch (e) { setError(e instanceof Error ? e.message : "Unable to prepare Jev review."); } finally { lock.current = false; setBusy(false); } }}>Review Jev request</button>}
    {state?.review?.state === "approved" && !expired && <button type="button" className="button" disabled={busy || dirty} onClick={() => void act({ action: "start_review", reviewId: state.review!.id })}>Start approved Jev review once</button>}
    {proposal && <div><p><strong>$0.01 maximum · one review · no retry.</strong><br/>Uses your saved OpenRouter balance. Anthropic credits do not cover this review.</p><p>Documented request bound: ${proposal.costAdmission.maxCostBoundUsd.toFixed(6)}. The provider has no total-dollar cutoff.</p><details><summary>Request and pricing details</summary><p>{proposal.model} · {proposal.inputBytes.toLocaleString()} bytes · {proposal.questionCount} questions. At most {proposal.costAdmission.maxBillableInputTokens.toLocaleString()} default-mode input tokens at ${proposal.pricing.inputUsdPerMillion}/million; output free. No provider fallback. Reported usage and cost appear after the request.</p></details><label className="studio-check"><input type="checkbox" checked={ack} onChange={e => setAck(e.target.checked)}/>I approve up to $0.01 for one Jev script review of this saved version.</label><button type="button" className="button" disabled={busy || !ack || !proposal.enabled} onClick={() => void review()}>Approve & request Jev score</button>{!proposal.enabled && <p>Paid Jev review is disabled pending the specific execution approval.</p>}</div>}
    </section>
  </div>;
}
