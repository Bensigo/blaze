"use client";
import { useEffect, useRef, useState } from "react";
import type { DiscoveryReview as Review } from "@/lib/discovery-review";
import "./discovery-review.css";

export function DiscoveryReview({ gameId }: { gameId: string }) {
  const [review, setReview] = useState<Review | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const generation = useRef(0);
  useEffect(() => {
    const current = ++generation.current;
    const controller = new AbortController(); setLoading(true); setReview(null); setError("");
    fetch(`/api/games/${encodeURIComponent(gameId)}/discovery`, { signal: controller.signal }).then(async r => { if (!r.ok) throw new Error(); return r.json(); }).then(data => { if (generation.current === current) setReview(data.review); }).catch(() => { if (!controller.signal.aborted) setError("Could not load the review."); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => { generation.current++; controller.abort(); };
  }, [gameId]);
  async function refresh() {
    const current = generation.current; setLoading(true); setError("");
    try { const r = await fetch(`/api/games/${encodeURIComponent(gameId)}/discovery`, { method: "POST" }); const data = await r.json(); if (!r.ok) throw new Error(data.error || "Could not refresh the review."); if (generation.current === current) setReview(data.review); }
    catch (e) { if (generation.current === current) setError(e instanceof Error ? e.message : "Could not refresh the review."); } finally { if (generation.current === current) setLoading(false); }
  }
  const fixes = review?.checks.filter(c => c.fix).sort((a, b) => (a.priority || 9) - (b.priority || 9)) || [];
  return <section className="discovery-review"><div className="discovery-head"><div><h2>Search &amp; answer readiness</h2><p>Public page checks, independent of gameplay and AI research.</p></div><button type="button" onClick={refresh} disabled={loading}>{loading ? "Checking…" : review ? "Refresh review" : "Run review"}</button></div>
    {error && <p role="alert">{error}</p>}{review && <><p>{review.source === "research baseline" ? "Cached research observation" : "Public audit"} · Observed {new Date(review.observedAt).toLocaleString()} · <a href={review.sourceUrl} target="_blank" rel="noreferrer">Source</a>{review.stale ? " · Stale: the registered game URL changed" : ""}. Static HTML only; this does not prove search indexing or AI visibility.</p>{fixes.length > 0 && <div><h3>Priorities</h3><ol>{fixes.map(c => <li key={c.label}>{c.fix}</li>)}</ol></div>}{([ ["technical", "Technical readiness"], ["answers", "Answer content"], ["search", "Search performance"], ["citations", "AI citations"] ] as const).map(([group, title]) => <div key={group}><h3>{title}</h3><div className="discovery-checks">{review.checks.filter(c => c.group === group).map(c => <article key={c.label}><div><strong>{c.label}</strong><span className={`discovery-status ${c.status}`}>{c.status === "passed" ? "Passed" : c.status === "attention" ? "Needs attention" : "Unmeasured"}</span></div><p>{c.detail}</p>{c.url && <a href={c.url} target="_blank" rel="noreferrer">View source</a>}</article>)}</div></div>)}</>}{!review && !loading && !error && <p>No review yet. Run a public-page check to see evidence.</p>}</section>;
}
