"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import type { DiscoveryReview as Review } from "@/lib/discovery-review";
import type { CitationEvidence } from "@/lib/citation-evidence";
import InfoHint from "./info-hint";


export function DiscoveryReview({ gameId }: { gameId: string }) {
  const [review, setReview] = useState<Review | null>(null);
  const [evidence, setEvidence] = useState<CitationEvidence | null>(null);
  const [citationError, setCitationError] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const generation = useRef(0);
  useEffect(() => {
    const current = ++generation.current;
    const controller = new AbortController(); setLoading(true); setReview(null); setEvidence(null); setCitationError(""); setError("");
    fetch(`/api/games/${encodeURIComponent(gameId)}/discovery`, { signal: AbortSignal.any([controller.signal,AbortSignal.timeout(20000)]) }).then(async r => { if (!r.ok) throw new Error(); return r.json(); }).then(data => { if (generation.current === current) setReview(data.review); }).catch(() => { if (!controller.signal.aborted) setError("Could not load the review."); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    fetch(`/api/games/${encodeURIComponent(gameId)}/citations`, { signal: controller.signal }).then(r => r.ok ? r.json() : Promise.reject()).then(data => { if (generation.current === current) setEvidence(data.evidence); }).catch(() => { if (!controller.signal.aborted) setCitationError("Could not load citation evidence."); });
    return () => { generation.current++; controller.abort(); };
  }, [gameId]);
  async function refresh() {
    const current = generation.current; setLoading(true); setError("");
    try { const r = await fetch(`/api/games/${encodeURIComponent(gameId)}/discovery`, { method: "POST",signal:AbortSignal.timeout(20000) }); const data = await r.json(); if (!r.ok) throw new Error(data.error || "Could not refresh the review."); if (generation.current === current) setReview(data.review); }
    catch (e) { if (generation.current === current) setError(e instanceof Error ? e.message : "Could not refresh the review."); } finally { if (generation.current === current) setLoading(false); }
  }
  async function saveCitation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setCitationError(""); const form = new FormData(event.currentTarget);
    try { const r = await fetch(`/api/games/${encodeURIComponent(gameId)}/citations`, {method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({page:form.get("page"),startDate:form.get("startDate"),endDate:form.get("endDate"),citations:Number(form.get("citations")),confirmed:form.get("confirmed") === "on"})}); const data=await r.json(); if (!r.ok) throw new Error(data.error || "Could not save evidence."); setEvidence(data.evidence); } catch(e) { setCitationError(e instanceof Error ? e.message : "Could not save evidence."); }
  }
  const fixes = review?.checks.filter(c => c.fix).sort((a, b) => (a.priority || 9) - (b.priority || 9)) || [];
  return <section className="discovery-review"><div className="discovery-head"><div><h2>Search &amp; answer readiness <InfoHint label="About SEO and answer checks">The audit inspects the public static page, robots.txt and sitemap.xml. Checks do not prove indexing, rankings or AI visibility. Connected Search Console observations are reported separately.</InfoHint></h2></div><button type="button" onClick={refresh} disabled={loading}>{loading ? "Checking…" : review ? "Refresh review" : "Run review"}</button></div>
    {error && <p role="alert">{error}</p>}{review && <><p className="discovery-observed">{review.source === "research baseline" ? "Cached" : "Checked"} {new Date(review.observedAt).toLocaleString()} · <a href={review.sourceUrl} target="_blank" rel="noreferrer">Source</a>{review.stale ? " · Stale: the registered game URL changed" : ""}</p>{fixes.length > 0 && <div className="discovery-priorities"><h3>Next steps</h3><ol>{fixes.map(c => <li key={c.label}>{c.fix}</li>)}</ol></div>}{([ ["technical", "Technical readiness"], ["answers", "Answer content"], ["search", "Search performance"], ["citations", "AI citations"] ] as const).map(([group, title]) => <div key={group}><h3>{title}</h3><div className="discovery-checks">{review.checks.filter(c => c.group === group).map(c => <article key={c.label}><div><strong>{c.label}<InfoHint label={`Details for ${c.label}`}>{c.detail}</InfoHint></strong><span className={`discovery-status ${c.status}`}>{c.status === "passed" ? "Passed" : c.status === "attention" ? "Needs attention" : "Unmeasured"}</span></div></article>)}</div></div>)}</>}{!review && !loading && !error && <p>No review yet. Run a public-page check to see evidence.</p>}
    <div className="citation-import"><h3>Bing AI citation evidence</h3><p>Owner-reported · not independently verified <InfoHint label="About Bing citation evidence">Copy a page-level count and dates from Bing Webmaster Tools AI Performance. Bing samples supported experiences; this is not a complete record or a ranking.</InfoHint> <a href="https://www.bing.com/webmasters/" target="_blank" rel="noreferrer">Open Bing</a></p>
    {evidence && <p>Owner-reported: {evidence.citations} citations for {evidence.page}, {evidence.startDate}–{evidence.endDate}. Saved {new Date(evidence.importedAt).toLocaleString()}.</p>}
    {citationError && <p role="alert">{citationError}</p>}
    <form onSubmit={saveCitation}><label>Exact game page URL<input name="page" type="url" required maxLength={2048} defaultValue={evidence?.page || review?.sourceUrl || ""} /></label><label>Start date<input name="startDate" type="date" required /></label><label>End date<input name="endDate" type="date" required /></label><label>Page citation count<input name="citations" type="number" required min="0" max="1000000000" step="1" /></label><label><input name="confirmed" type="checkbox" required /> I copied this page count and date range from Bing AI Performance.</label><button type="submit">Save reported evidence</button></form></div></section>;
}
