"use client";

import { useState } from "react";
import type { Game } from "@/lib/types";
import "./launch-links.css";

export function buildLaunchUrl(base: string, source: string, campaign: string): string {
  const url = new URL(base);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('A public HTTP or HTTPS game URL is required.');
  const clean = (value: string) => value.trim().slice(0, 100);
  const s = clean(source), c = clean(campaign);
  if (!s || !c) throw new Error('Enter a source and campaign.');
  url.searchParams.set('utm_source', s);
  url.searchParams.set('utm_campaign', c);
  return url.href;
}

export default function LaunchLinks({ games, gameId }: { games: Game[]; gameId: string }) {
  const [choice, setChoice] = useState('');
  const [source, setSource] = useState('');
  const [campaign, setCampaign] = useState('');
  const [status, setStatus] = useState('');
  const game = games.find(g => g.id === (gameId === 'all' ? choice : gameId));
  let url = '', error = '';
  if (game && source.trim() && campaign.trim()) { try { url = buildLaunchUrl(game.url, source, campaign); } catch (e) { error = e instanceof Error ? e.message : 'Invalid URL'; } }
  async function copy() { try { await navigator.clipboard.writeText(url); setStatus('Copied'); } catch { setStatus('Copy failed. Select the link and copy it manually.'); } }
  return <section className="launch-links"><h2>Build a launch link</h2><p>Choose a game and add a source and campaign. Do not include personal information.</p>
    {gameId === 'all' && <label>Game<select value={choice} onChange={e=>{setChoice(e.target.value);setStatus('');}}><option value="">Select a game</option>{games.map(g=><option key={g.id} value={g.id}>{g.title}</option>)}</select></label>}
    {gameId !== 'all' && <p>{game?.title}</p>}
    <div className="launch-link-fields"><label>Source<input maxLength={100} value={source} onChange={e=>{setSource(e.target.value);setStatus('');}} placeholder="e.g. instagram" /></label><label>Campaign<input maxLength={100} value={campaign} onChange={e=>{setCampaign(e.target.value);setStatus('');}} placeholder="e.g. launch-week" /></label></div>
    {url && <><label>Tagged link<input readOnly value={url} onFocus={e=>e.currentTarget.select()} /></label><button type="button" onClick={copy}>Copy link</button></>}
    <p role="status">{error || status}</p>
  </section>;
}
