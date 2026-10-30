"use client";

import { useState } from "react";
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

export default function GameConnections({ games, origin, onAdd, onSetup, onSessions }: { games: Game[]; origin: string; onAdd: () => void; onSetup: (gameId: string) => void; onSessions: (gameId: string) => void }) {
  const [selectedId, setSelectedId] = useState("");
  const game = games.find((item) => item.id === selectedId) || games[0];
  return <section className="game-connections" aria-labelledby="game-connections-title">
    <div className="game-connections-heading"><div><h2 id="game-connections-title">Game connections</h2><p>SDK details for your registered games.</p></div></div>
    {!game ? <div className="game-connections-empty"><p>No games added yet.</p><button type="button" className="game-connections-primary" onClick={onAdd}>Add a game</button></div> : <>
      <label className="game-connections-selector">Game<select value={game.id} onChange={(event) => setSelectedId(event.target.value)}>{games.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
      <div className="game-connections-detail">
        <div className="game-connections-intro"><h3>{game.title}</h3><p><span className="game-connections-status">SDK telemetry unverified</span> Check Sessions for consented events. Imported metadata does not verify SDK installation.</p></div>
        <dl className="game-connections-list">
          <div><dt>Public game URL</dt><dd><Address value={game.url} /></dd></div>
          <div><dt>Manifest provenance</dt><dd>{game.manifestSource ? <><span>Metadata imported · version {game.manifestSource.formatVersion} · checked {observedDate(game.manifestSource.observedAt)}</span><Address value={game.manifestSource.url} /><span className="game-connections-hash">SHA-256: {game.manifestSource.sha256}</span></> : <span>Legacy record · manifest source unavailable</span>}</dd></div>
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
