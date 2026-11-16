"use client";

import { useEffect, useState, type FormEvent } from "react";
import { ExternalLink, Search } from "lucide-react";
import { browserRead } from "@/lib/browser-read";
import type { PortalGapView } from "@/lib/portal-gap-types";
import "./portal-gaps.css";

type Row = PortalGapView["rows"][number];

function searchUrl(domain: string, title: string) {
  return "https://www.google.com/search?" + new URLSearchParams({ q: `site:${domain} "${title}"` });
}
function Link({ href, children }: { href: string; children: React.ReactNode }) {
  return <a href={href} target="_blank" rel="noreferrer">{children} <ExternalLink size={13} aria-hidden /></a>;
}

export default function PortalGaps({ gameId, title }: { gameId: string; title: string }) {
  const endpoint = `/api/games/${encodeURIComponent(gameId)}/portal-gaps`;
  const [data, setData] = useState<PortalGapView | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError("");
    void browserRead<PortalGapView>(endpoint, controller.signal).then(setData).catch(reason => {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Could not load portal gaps.");
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [endpoint, reload]);
  async function save(payload: unknown) {
    setSaving(true); setError("");
    try {
      const response = await fetch(endpoint, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload), signal: AbortSignal.timeout(20_000) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not save this listing.");
      setData(result as PortalGapView);
      return true;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not save this listing.");
      return false;
    } finally { setSaving(false); }
  }
  if (loading) return <div className="ci-empty" role="status">Loading portal gaps…</div>;
  if (!data) return <div className="ci-empty" role="alert">{error || "Could not load portal gaps."}<button className="button" onClick={() => setReload(n => n + 1)}>Retry</button></div>;
  const rank = (row: Row) => row.rivals.length && row.own.status === "not_listed" ? 0 : row.rivals.length && row.own.status === "unknown" ? 1 : row.own.status === "listed" ? 3 : 2;
  const rows = [...data.rows].sort((a, b) => rank(a) - rank(b));
  return <div className="pg-view">
    <div className="pg-intro"><h3>Portal gaps</h3><p>Find portals where a rival has a saved listing and you’ve confirmed your game is unlisted. Search for additional listings in your browser.</p></div>
    {error && <div className="ci-error" role="alert">{error}</div>}
    {!data.targets.length && <div className="pg-notice">Add a web competitor to your watchlist to save rival portal listings. You can still check your own listings below.</div>}
    {!rows.length && <div className="ci-empty">No portals are available yet.</div>}
    <div className="pg-grid">{rows.map(row => <PortalCard key={row.id} row={row} title={title} targets={data.targets} saving={saving} save={save}/>)}</div>
  </div>;
}

function PortalCard({ row, title, targets, saving, save }: { row: Row; title: string; targets: PortalGapView["targets"]; saving: boolean; save: (payload: unknown) => Promise<boolean> }) {
  const [status, setStatus] = useState(row.own.status);
  const [ownUrl, setOwnUrl] = useState(row.own.url || "");
  const [targetId, setTargetId] = useState("");
  const [rivalUrl, setRivalUrl] = useState("");
  useEffect(() => { setStatus(row.own.status); setOwnUrl(row.own.url || ""); }, [row.own.status, row.own.url]);
  const selected = targets.find(target => target.id === targetId);
  const label = row.own.status === "not_listed" && row.rivals.length ? "Confirmed gap" : row.own.status === "unknown" && row.rivals.length ? "Check your listing" : row.own.status === "listed" ? "Your game is listed" : row.own.status === "not_listed" ? "Marked unlisted" : "Not checked";
  const submitRival = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (await save({ action: "save_rival", portalId: row.id, targetId, url: rivalUrl })) setRivalUrl("");
  };
  return <article className="pg-card">
    <div className="pg-card-head"><h4>{row.name}</h4><span className={"pg-status " + (label === "Confirmed gap" ? "gap" : label === "Check your listing" ? "check" : "")}>{label}</span></div>
    <p className="pg-count">{row.rivals.length ? `${row.rivals.length} saved rival ${row.rivals.length === 1 ? "listing" : "listings"}` : "No rival listings saved"}</p>
    <div className="pg-links"><Link href={searchUrl(row.searchDomain, title)}><Search size={13} aria-hidden/> Search for {title}</Link>{row.own.url && <Link href={row.own.url}>Your listing</Link>}<Link href={row.publishUrl}>Publishing information</Link></div>
    {row.own.checkedAt && <p className="pg-meta">Own status checked {new Date(row.own.checkedAt).toLocaleDateString()}{row.own.source === "watchlist" ? " · from watchlist" : " · manually recorded"}</p>}
    {row.rivals.length > 0 && <ul className="pg-rivals">{row.rivals.map(rival => <li key={rival.targetId}><Link href={rival.url}>{rival.title}</Link><span>{rival.source === "watchlist" ? "From watchlist" : "Saved manually"}</span><button type="button" disabled={saving} onClick={() => void save({ action: "remove_rival", portalId: row.id, targetId: rival.targetId })}>Remove</button></li>)}</ul>}
    <details><summary>Update your listing</summary><form onSubmit={event => { event.preventDefault(); void save({ action: "set_own", portalId: row.id, status, ...(status === "listed" ? { url: ownUrl } : {}) }); }}>
      <label>Your status<select value={status} onChange={event => setStatus(event.target.value as Row["own"]["status"])}><option value="unknown">Unchecked</option><option value="listed">Listed</option><option value="not_listed">Confirmed unlisted</option></select></label>
      {status === "listed" && <label>Listing URL<input type="url" required maxLength={2000} value={ownUrl} placeholder="https://…" onChange={event => setOwnUrl(event.target.value)}/></label>}
      <button className="button" disabled={saving} type="submit">{saving ? "Saving…" : "Save status"}</button>
    </form></details>
    {targets.length > 0 && <details><summary>Add a rival listing</summary><form onSubmit={submitRival}>
      <label>Saved web competitor<select required value={targetId} onChange={event => setTargetId(event.target.value)}><option value="">Choose a competitor</option>{targets.map(target => <option key={target.id} value={target.id}>{target.title}</option>)}</select></label>
      {selected && <Link href={searchUrl(row.searchDomain, selected.title)}><Search size={13} aria-hidden/> Search for {selected.title}</Link>}
      <label>Rival listing URL<input type="url" required maxLength={2000} value={rivalUrl} placeholder="https://…" onChange={event => setRivalUrl(event.target.value)}/></label>
      <button className="button" disabled={saving} type="submit">{saving ? "Saving…" : "Save rival listing"}</button>
    </form></details>}
  </article>;
}
