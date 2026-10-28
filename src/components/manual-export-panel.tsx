"use client";
import { useState } from "react";
import type { Post } from "@/lib/types";

type Prepared = { caption: string; channel: string; destination: string; destinationVerified: false; scheduledAt: string | null; timeZone: string | null; downloadUrl: string; exportedAt: string; recommendation: { platform: string; platformReason: string; time: string; confidence: string; source: string } };
function plannedTime(value: string, timeZone: string | null) {
  try { return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short", ...(timeZone ? { timeZone } : {}) }).format(new Date(value)); }
  catch { return new Date(value).toLocaleString(); }
}
export default function ManualExportPanel({ post, onChanged }: { post: Post; onChanged: () => void | Promise<void> }) {
  const [prepared, setPrepared] = useState<Prepared | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [publishedAt, setPublishedAt] = useState("");
  const [url, setUrl] = useState("");
  const canPrepare = ["approved", "scheduled"].includes(post.status);
  async function prepare() {
    setBusy(true); setError(""); setCopied(false);
    try {
      const response = await fetch(`/api/posts/${encodeURIComponent(post.id)}/manual-export`, { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not prepare the export.");
      setPrepared(data); await onChanged();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not prepare the export."); }
    finally { setBusy(false); }
  }
  async function confirmPublication() {
    setError("");
    const time = new Date(publishedAt);
    if (!publishedAt || !Number.isFinite(time.getTime())) { setError("Enter the actual publication time in your browser's local time."); return; }
    setBusy(true);
    try {
      const response = await fetch(`/api/posts/${encodeURIComponent(post.id)}/manual-confirm`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ publishedAt: time.toISOString(), url }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not record your confirmation.");
      await onChanged();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not record your confirmation."); }
    finally { setBusy(false); }
  }
  if (post.deliveryMethod !== "manual") return null;
  return <section className="review-content" aria-label="Manual publishing">
    <h3>Manual publishing</h3>
    <p className="muted">Destination: {post.accountId || "Not set"} · unverified. Preparing an export does not publish it.</p>
    {post.manualExportedAt && <p>Export prepared {new Date(post.manualExportedAt).toLocaleString()}.</p>}
    {post.manualConfirmedAt && <p>User-confirmed publication: {post.manualPublishedAt ? new Date(post.manualPublishedAt).toLocaleString() : "time not recorded"}. {post.manualPublicationUrl && <a href={post.manualPublicationUrl} target="_blank" rel="noreferrer">Open submitted URL</a>} <span className="muted">Not verified by the platform.</span></p>}
    {!canPrepare && <p className="muted">Submit this draft for review and approve it before exporting.</p>}
    <button type="button" className="button primary" disabled={!canPrepare || busy} onClick={prepare}>{busy ? "Working…" : "Prepare approved export"}</button>
    {prepared && <>
      <p>Approved caption for {prepared.channel}:</p>
      <div className="review-text">{prepared.caption}</div>
      <div className="modal-actions">
        <button type="button" className="button" onClick={async () => { try { await navigator.clipboard.writeText(prepared.caption); setCopied(true); } catch { setError("Copy failed. Select and copy the caption instead."); } }}>{copied ? "Caption copied" : "Copy caption"}</button>
        <a className="button" href={prepared.downloadUrl}>Download video</a>
      </div>
      <p className="muted">Suggested starting channel: {prepared.recommendation.platform} · {prepared.recommendation.confidence} confidence. {prepared.recommendation.platformReason}</p>
      <p className="muted">{prepared.recommendation.time} Source: {prepared.recommendation.source}.</p>
      <p className="muted">Planned time: {prepared.scheduledAt ? plannedTime(prepared.scheduledAt, prepared.timeZone) : "Not set"}{prepared.timeZone ? ` · ${prepared.timeZone}` : " · browser local time"}. Change the schedule in the post editor and approve again.</p>
    </>}
    {(prepared || post.manualExportedAt) && !post.manualConfirmedAt && <div>
      <p>After you publish on the platform, record what happened. This is your confirmation, not a platform verification.</p>
      <label className="field"><span>Actual publication time (browser local time)</span><input type="datetime-local" value={publishedAt} onChange={e => setPublishedAt(e.target.value)} /></label>
      <label className="field"><span>Published post URL</span><input type="url" placeholder="https://…" value={url} onChange={e => setUrl(e.target.value)} /></label>
      <button type="button" className="button" disabled={busy || !publishedAt || !url} onClick={confirmPublication}>Record my confirmation</button>
    </div>}
    {error && <p className="error-text" role="alert">{error}</p>}
  </section>;
}
