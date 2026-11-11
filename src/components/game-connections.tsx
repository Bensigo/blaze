"use client";

import { useState } from "react";
import InfoHint from "./info-hint";
import type { Game } from "@/lib/types";


function externalUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? value : undefined;
  } catch { return undefined; }
}
function Address({ value }: { value: string }) {
  const href = externalUrl(value);
  return href ? <a href={href} target="_blank" rel="noreferrer">{value}</a> : <span>{value || "Unavailable"}</span>;
}
function observedDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

export default function GameConnections({ games, origin, onAdd, onSetup, onSessions, onSynced }: { games: Game[]; origin: string; onAdd: () => void; onSetup: (gameId: string) => void; onSessions: (gameId: string) => void; onSynced?: () => void|Promise<void> }) {
  const [selectedId, setSelectedId] = useState("");
  const [syncing,setSyncing]=useState(false),[syncStatus,setSyncStatus]=useState("");
  async function syncCatalogue(){
    setSyncing(true);setSyncStatus("");
    try{const r=await fetch('/api/actions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'sync_forever_catalogue'})});const data=await r.json();if(!r.ok)throw Error(data.error||'Catalogue sync failed.');setSyncStatus(`${data.listed} current games synced. ${data.retired} historical games retained. Game list updated.`);await onSynced?.();}catch(error){setSyncStatus(error instanceof Error?error.message:'Catalogue sync failed.');}finally{setSyncing(false);}
  }
  const game = games.find((item) => item.id === selectedId) || games[0];
  const source=game&&externalUrl(game.url),sourceOrigin=source?new URL(source).origin:undefined;
  return <section className="game-connections" aria-labelledby="game-connections-title">
    <div className="game-connections-heading"><div><h2 id="game-connections-title">Game connections</h2></div></div>
    <div className="game-connections-sync"><button type="button" className="game-connections-secondary" disabled={syncing} onClick={()=>void syncCatalogue()}>{syncing?'Syncing Forever…':'Sync Forever catalogue'}</button><p role="status">{syncStatus}</p><InfoHint label="About catalogue sync">Update URLs, metadata and tracking origins from Forever’s catalogue. Historical records and keys are retained.</InfoHint></div>
    {!game ? <div className="game-connections-empty"><p>No games added yet.</p><button type="button" className="game-connections-primary" onClick={onAdd}>Add a game</button></div> : <>
      <label className="game-connections-selector">Game<select value={game.id} onChange={(event) => setSelectedId(event.target.value)}>{games.map((item) => <option key={item.id} value={item.id}>{item.title}{item.foreverCatalogue?.state==='retired'?' (historical)':''}</option>)}</select></label>
      <div className="game-connections-detail">
        {sourceOrigin&&!game.origins.includes(sourceOrigin) && <p role="alert">This game’s source origin is missing from its allowed origins. Tracking requests from that page will be rejected.</p>}
        {game.foreverCatalogue?.state==='retired' && <p>Historical Forever entry. Its records and key are retained; it is no longer listed on Forever Home.</p>}
        <div className="game-connections-intro"><h3>{game.title}</h3><p><span className="game-connections-status">{game.telemetry?.lastEventAt?'Events received':'No recent SDK events'}</span> <InfoHint label="About SDK verification">{game.telemetry?.lastEventAt?`${game.telemetry.humanEvents.toLocaleString()} non-test human-protocol events in the last 14 days. Latest: ${observedDate(game.telemetry.lastEventAt)}.`:'Check origins and a consented visit. Metadata import alone does not verify tracking.'}</InfoHint></p></div>
        <dl className="game-connections-list">
          <div><dt>Public game URL</dt><dd><Address value={game.url} /></dd></div>
          <div><dt>Metadata source</dt><dd>{game.manifestSource ? <details><summary>Imported · {observedDate(game.manifestSource.observedAt)}</summary><span>Version {game.manifestSource.formatVersion}</span><Address value={game.manifestSource.url} /><span className="game-connections-hash">SHA-256: {game.manifestSource.sha256}</span></details> : <span>Unavailable</span>}</dd></div>
          <div><dt>Game ID</dt><dd><code>{game.id}</code></dd></div>
          <div><dt>Public SDK key</dt><dd><code>{game.sdkKey || "Unavailable"}</code></dd></div>
          <div><dt>SDK endpoint</dt><dd><code>{origin || "Unavailable"}</code></dd></div>
          <div><dt>Allowed origins</dt><dd>{game.origins?.length ? game.origins.map((value) => <code key={value}>{value}</code>) : <span>None configured</span>}</dd></div>
        </dl>
        <div className="game-connections-actions"><button type="button" className="game-connections-primary" onClick={() => onSetup(game.id)}>Setup instructions</button><button type="button" className="game-connections-secondary" onClick={() => onSessions(game.id)}>Inspect sessions</button></div>
      </div>
    </>}
  </section>;
}
