"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import type { Game } from "@/lib/types";

type Archive = { id: string; game: Game; deletedAt: string };
export default function GameArchiveControls({ games, demo, onUpdated }: { games: Game[]; demo: boolean; onUpdated: () => Promise<unknown> }) {
  const [archives, setArchives] = useState<Archive[]>([]); const [chosen, setChosen] = useState<Game | null>(null);
  const [confirmation, setConfirmation] = useState(""); const [error, setError] = useState(""); const [busy, setBusy] = useState(false); const lock = useRef(false);
  const read = async () => { const response = await fetch("/api/game-archive", { cache: "no-store" }); const data = await response.json(); if (!response.ok) throw new Error(data.error); setArchives(data.games); };
  useEffect(() => { if (!demo) void read().catch(() => setError("Unable to load deleted games.")); }, [demo]);
  const act = async (body: Record<string, unknown>) => {
    if (lock.current) return; lock.current = true; setBusy(true); setError("");
    try { const response = await fetch("/api/game-archive", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); const data = await response.json(); if (!response.ok) throw new Error(data.error); setChosen(null); setConfirmation(""); await read(); await onUpdated(); }
    catch (error) { setError(error instanceof Error ? error.message : "Unable to update this game."); } finally { lock.current = false; setBusy(false); }
  };
  if (demo) return null;
  return <details className="studio-setup"><summary>Manage games · delete and restore</summary>
    {error && <p role="alert">{error}</p>}
    <p>Deleted games leave the active dashboard and daily idea list. Analytics and content are retained for restore.</p>
    {games.map(game => <div className="studio-video-actions" key={game.id}><span>{game.title}</span><button className="button" disabled={busy} onClick={() => { setChosen(game); setConfirmation(""); setError(""); }}>Delete game</button></div>)}
    {chosen && <form aria-label={`Delete ${chosen.title}`} className="studio-approval" onSubmit={(event: FormEvent) => { event.preventDefault(); void act({ action: "delete", gameId: chosen.id, confirmation }); }}>
      <h3>Delete {chosen.title}?</h3><p>This removes it from your active dashboard and cancels queued work. Its data stays available in Deleted games. Active or uncertain runs must be stopped or reconciled first.</p>
      <label>Type {chosen.title} to confirm<input aria-label="Game name confirmation" value={confirmation} onChange={e => setConfirmation(e.target.value)} disabled={busy}/></label>
      <div className="studio-video-actions"><button className="button" disabled={busy || confirmation !== chosen.title}>Confirm delete game</button><button className="button" type="button" disabled={busy} onClick={() => { setChosen(null); setConfirmation(""); }}>Cancel</button></div>
    </form>}
    <h3>Deleted games</h3>{!archives.length && <p>No deleted games.</p>}
    {archives.map(archive => <div className="studio-video-actions" key={archive.id}><span>{archive.game.title}</span><button className="button" disabled={busy} onClick={() => void act({ action: "restore", gameId: archive.id })}>Restore game</button></div>)}
  </details>;
}
