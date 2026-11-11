"use client";

import { useEffect, useState, type FormEvent } from "react";
import { ExternalLink, Globe, List, Pencil, Plus, RefreshCw, Search, Smartphone, Store, Trash2 } from "lucide-react";
import { browserRead } from "@/lib/browser-read";
import {
  competitorCountries, competitorLimit, competitorPlatforms, type CompetitorEntry,
  type CompetitorMarket, type CompetitorTarget, type CompetitorView as ViewData,
} from "@/lib/competitor-types";
import InfoHint from "./info-hint";
import "./competitor-view.css";

const sections = [
  { id: "watchlist", title: "Watchlist", icon: List },
  { id: "web", title: "Web search", icon: Search },
  { id: "stores", title: "App stores", icon: Store },
] as const;
type Section = typeof sections[number]["id"];
type EditEntry = CompetitorEntry & { id?: string };
const freshEntry = { title: "", url: "", owned: false };
const count = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 });
const format = (value: number | null | undefined) => value == null ? "—" : count.format(value);
const estimate = (value: number | null | undefined) => value != null && value > 0 && value < 1 ? "<1" : format(value);

function targetPath(target: CompetitorTarget) {
  if (target.appId) return target.appId;
  const url = new URL(target.url);
  return url.host + (url.pathname === "/" ? "" : url.pathname);
}

function TargetName({ target }: { target: CompetitorTarget }) {
  return <div className="ci-target">
    <span className="ci-platform-icon" aria-hidden>{target.platform === "web" ? <Globe size={16}/> : <Smartphone size={16}/>}</span>
    <div className="ci-target-body">
      <a href={target.url} target="_blank" rel="noreferrer" title={target.url}>
        <strong>{target.title}</strong><ExternalLink size={12} aria-hidden/>
      </a>
      <small>{targetPath(target)}</small>
    </div>
    {target.owned && <span className="ci-badge ci-own">Your game</span>}
  </div>;
}

function Delta({ value, label }: { value: number | undefined; label: string }) {
  if (!value) return null;
  return <small className={value > 0 ? "ci-delta up" : "ci-delta down"} title={label}>
    <span aria-hidden>{value > 0 ? "↑" : "↓"} {Math.abs(value)}</span>
    <span className="sr-only">{label}: {value > 0 ? "up" : "down"} {Math.abs(value)}</span>
  </small>;
}

export default function CompetitorView({ gameId, title }: { gameId: string; title: string }) {
  const url = "/api/games/" + encodeURIComponent(gameId) + "/competitors";
  const [data, setData] = useState<ViewData | null>(null);
  const [section, setSection] = useState<Section>("watchlist");
  const [editing, setEditing] = useState<EditEntry | null>(null);
  const [market, setMarket] = useState<CompetitorMarket>({ country: "US", device: "desktop", keyword: "" });
  const [request, setRequest] = useState<"save" | "refresh" | null>(null);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setError("");
    void browserRead<ViewData>(url, controller.signal).then(view => {
      if (controller.signal.aborted) return;
      setData(view);
      if (view.latest) setMarket(view.latest.market);
    }).catch(reason => { if (!controller.signal.aborted) setError(reason.message || "Could not load the watchlist."); });
    return () => controller.abort();
  }, [url, reload]);

  async function send(method: "PUT" | "POST", payload: unknown) {
    setError("");
    setRequest(method === "PUT" ? "save" : "refresh");
    try {
      const response = await fetch(url, {
        method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
        signal: AbortSignal.timeout(20_000),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not save the changes.");
      const view = result as ViewData;
      setData(view);
      if (method === "POST" && section === "watchlist")
        setSection(view.targets.some(target => target.platform === "web") ? "web" : "stores");
      return true;
    } catch (reason) {
      setError(reason instanceof Error && reason.name !== "TimeoutError" ? reason.message : "The request timed out. Reload before retrying.");
      return false;
    } finally { setRequest(null); }
  }

  function saveEntries(entries: CompetitorEntry[]) {
    return send("PUT", { revision: data?.watchlist.revision, entries: entries.map(({ title, url, owned }) => ({ title, url, ...(owned ? { owned: true } : {}) })) });
  }

  async function saveEntry(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!data || !editing || request) return;
    const index = data.watchlist.entries.findIndex(target => target.id === editing.id);
    const entries: CompetitorEntry[] = data.watchlist.entries.slice();
    if (index < 0) entries.push(editing);
    else entries[index] = editing;
    if (await saveEntries(entries)) setEditing(null);
  }

  if (!data) return error ? <div className="ci-empty" role="alert">{error} <button type="button" className="button" onClick={() => setReload(value => value + 1)}>Retry</button></div> :
    <p role="status" className="ci-empty">Loading watchlist…</p>;

  const rivals = data.targets.filter(target => !target.owned).length;
  const web = data.targets.filter(target => target.platform === "web");
  const stores = data.targets.filter(target => target.platform !== "web");
  const latest = data.latest;
  const previous = data.stale ? null : data.previous;
  const changedFilters = !!latest && (latest.market.country !== market.country || latest.market.device !== market.device || latest.market.keyword !== market.keyword.trim());
  const observed = latest ? new Date(latest.observedAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : null;
  const canRefresh = data.providerConnected && rivals > 0 && !request;
  const submitMarket = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (canRefresh) void send("POST", market);
  };

  return <section className="ci-workspace" aria-label={title + " competitors"} aria-busy={!!request}>
    <div className="ci-head">
      <div><h2>{title}</h2><span className="ci-muted">{rivals} / {competitorLimit} competitors</span></div>
      <div className="ci-head-actions">
        <span className={"ci-badge " + (data.providerConnected ? "ci-connected" : "")}>
          <span className="ci-dot" aria-hidden/>{data.providerConnected ? "DataForSEO connected" : "Data source off"}
        </span>
        <InfoHint label="About competitor data">
          Watchlists work without a data provider. A refresh updates all tracked sources for the selected market. Estimated visits and keyword demand are not player counts or downloads.
        </InfoHint>
        <button type="button" className="button primary" disabled={!!request} onClick={() => { setSection("watchlist"); setEditing(freshEntry); }}>
          <Plus size={16}/> Add listing
        </button>
      </div>
    </div>
    <nav className="ci-tabs" aria-label="Competitor views">
      {sections.map(({ id, title: label, icon: Icon }) => <button type="button" key={id}
        aria-pressed={section === id} className={section === id ? "active" : ""}
        onClick={() => setSection(id)}><Icon size={16} aria-hidden/>{label}</button>)}
    </nav>
    {error && <div className="ci-error" role="alert"><span>{error}</span><button type="button" className="button" disabled={!!request} onClick={() => setReload(value => value + 1)}>Reload</button></div>}
    {section === "watchlist" && <>
      {editing && <form className="ci-editor" onSubmit={saveEntry}>
        <div className="ci-editor-fields">
          <label>Game name<input required maxLength={120} autoFocus value={editing.title} onChange={event => setEditing({ ...editing, title: event.target.value })}/></label>
          <label>Game page or store URL<input required type="url" maxLength={2000} placeholder="https://…" value={editing.url} onChange={event => setEditing({ ...editing, url: event.target.value })}/></label>
        </div>
        <div className="ci-editor-actions">
          <label className="ci-check"><input type="checkbox" checked={!!editing.owned} onChange={event => setEditing({ ...editing, owned: event.target.checked })}/> My game’s listing</label>
          <button type="button" className="button" disabled={!!request} onClick={() => { setEditing(null); setError(""); }}>Cancel</button>
          <button type="submit" className="button primary" disabled={!!request}>{request === "save" ? "Saving…" : editing.id ? "Save listing" : "Add to watchlist"}</button>
        </div>
      </form>}
      {data.targets.length > 0 && <ul className="ci-watchlist">
        {data.targets.map(target => {
          const editable = data.watchlist.entries.some(entry => entry.id === target.id);
          return <li key={target.id}>
            <TargetName target={target}/>
            <span className="ci-platform">{competitorPlatforms[target.platform]}</span>
            <div className="ci-row-actions">
              {editable && <>
                <button className="icon-button" type="button" aria-label={"Edit " + target.title} title="Edit" disabled={!!request} onClick={() => setEditing(target)}><Pencil size={15}/></button>
                <button className="icon-button" type="button" aria-label={"Remove " + target.title} title="Remove from watchlist" disabled={!!request} onClick={async () => {
                  if (await saveEntries(data.watchlist.entries.filter(entry => entry.id !== target.id)) && editing?.id === target.id) setEditing(null);
                }}><Trash2 size={15}/></button>
              </>}
            </div>
          </li>;
        })}
      </ul>}
      {!rivals && !editing && <div className="ci-empty"><List size={22} aria-hidden/><strong>No competitors yet</strong><span>Add a game page, App Store link or Google Play link.</span></div>}
      {rivals > 0 && <div className="ci-footer">
        <span>{observed ? "Updated " + observed : "No report yet"}{data.stale ? " · Watchlist changed" : ""}</span>
        <button type="button" className="button" onClick={() => setSection(web.length ? "web" : "stores")}>View comparison</button>
      </div>}
    </>}
    {section !== "watchlist" && <>
      <form className="ci-market" onSubmit={submitMarket}>
        <label>Market<select value={market.country} onChange={event => setMarket({ ...market, country: event.target.value })}>
          {Object.entries(competitorCountries).map(([code, name]) => <option key={code} value={code}>{name}</option>)}
        </select></label>
        {section === "web" && web.length > 0 && <>
          <label>Device<select value={market.device} onChange={event => setMarket({ ...market, device: event.target.value as CompetitorMarket["device"] })}><option value="desktop">Desktop</option><option value="mobile">Mobile</option></select></label>
          <label className="ci-keyword">Search phrase<input maxLength={80} value={market.keyword} placeholder="e.g. browser puzzle games" onChange={event => setMarket({ ...market, keyword: event.target.value })}/></label>
        </>}
        <button type="submit" className="button primary" disabled={!canRefresh}><RefreshCw size={15} className={request === "refresh" ? "spin" : undefined}/>{request === "refresh" ? "Refreshing…" : "Refresh data"}</button>
      </form>
      {latest && <div className="ci-report-meta" aria-live="polite">
        <time dateTime={latest.observedAt}>{observed}</time>
        <span>{competitorCountries[latest.market.country as keyof typeof competitorCountries] || latest.market.country} · English</span>
        {section === "web" && <span>{latest.market.device === "mobile" ? "Mobile" : "Desktop"}{latest.market.keyword ? " · " + latest.market.keyword : ""}</span>}
        {(data.stale || changedFilters) && <span className="ci-badge">Refresh to update</span>}
      </div>}
      {!data.providerConnected ? <div className="ci-empty"><strong>DataForSEO isn’t connected</strong><span>Your watchlist is saved. Enable the provider to run reports.</span></div> :
        !rivals ? <div className="ci-empty"><strong>Add a competitor to compare</strong><button type="button" className="button" onClick={() => { setSection("watchlist"); setEditing(freshEntry); }}>Add listing</button></div> :
        section === "web" && !web.length ? <div className="ci-empty"><strong>No web game pages</strong><span>Add a game page to compare web search.</span></div> :
        section === "stores" && !stores.length ? <div className="ci-empty"><strong>No mobile listings</strong><span>Add an App Store or Google Play game.</span></div> :
        !latest ? <div className="ci-empty"><strong>No report yet</strong><span>Choose a market and refresh.</span></div> :
        section === "web" ? <>
          <div className="ci-table-scroll" tabIndex={0} aria-label="Web search comparison">
            <table className="ci-table" role="table">
              <thead><tr><th scope="col">Game page</th><th scope="col">Organic rank</th><th scope="col">Monthly search visits <span className="ci-badge ci-estimate">Estimated</span></th></tr></thead>
              <tbody role="rowgroup">{web.map(target => {
                const row = latest.evidence.web[target.id];
                const rank = row?.rank;
                const prior = previous?.evidence.web[target.id]?.rank;
                return <tr key={target.id} role="row"><th scope="row" role="rowheader"><TargetName target={target}/></th>
                  <td role="cell" data-label="Organic rank">{rank != null ? <><strong>#{rank}</strong><Delta value={prior != null ? prior - rank : undefined} label="Rank change"/></> : row && latest.evidence.sources.search === "ok" ? "Not seen" : "—"}</td>
                  <td role="cell" data-label="Estimated monthly search visits">{estimate(row?.estimatedVisits)}</td></tr>;
              })}</tbody>
            </table>
          </div>
          <div className="ci-footer"><span>DataForSEO · Exact page <InfoHint label="About web search metrics">Rank is the observed organic position for this phrase, market and device, within the first results page. Monthly visits are provider estimates for organic search only.</InfoHint></span><span>
            {latest.evidence.sources.search === "unavailable" ? "Rank unavailable" : latest.evidence.sources.search === "skipped" ? "Enter a phrase to track rank" : "Rank observed"}
            {" · "}{latest.evidence.sources.traffic === "ok" ? "Traffic estimated" : "Traffic unavailable"}
          </span></div>
        </> : <>
          <div className="ci-table-scroll" tabIndex={0} aria-label="App store search comparison">
            <table className="ci-table" role="table">
              <thead><tr><th scope="col">Listing</th><th scope="col">Ranked keywords</th><th scope="col">Top 10</th><th scope="col">Keyword demand <span className="ci-badge ci-estimate">Estimated</span></th></tr></thead>
              <tbody role="rowgroup">{stores.map(target => {
                const row = latest.evidence.stores[target.id];
                const prior = previous?.evidence.stores[target.id];
                return <tr key={target.id} role="row"><th scope="row" role="rowheader"><TargetName target={target}/><small className="ci-store-name">{competitorPlatforms[target.platform]}</small></th>
                  <td role="cell" data-label="Ranked keywords">{format(row?.rankedKeywords)}</td>
                  <td role="cell" data-label="Top 10 keywords">{format(row?.topTenKeywords)}<Delta value={row && prior ? row.topTenKeywords - prior.topTenKeywords : undefined} label="Top 10 keyword change"/></td>
                  <td role="cell" data-label="Estimated keyword demand">{estimate(row?.estimatedSearchVolume)}</td></tr>;
              })}</tbody>
            </table>
          </div>
          <div className="ci-footer"><span>DataForSEO · Store keyword index <InfoHint label="About store metrics">Counts use the provider’s indexed keywords in each store. Estimated keyword demand measures searches for those phrases, not downloads. A dash means data is unavailable.</InfoHint></span><span>
            {(["ios", "android"] as const).filter(key => latest.evidence.sources[key] === "unavailable").map(key => competitorPlatforms[key] + " unavailable").join(" · ")}
          </span></div>
        </>}
    </>}
  </section>;
}
