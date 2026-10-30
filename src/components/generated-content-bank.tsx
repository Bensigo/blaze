"use client";
import {useCallback,useEffect,useState} from "react";
import type {StudioSnapshot} from "@/lib/content-studio-contract";
import type {Game} from "@/lib/types";
import {browserRead} from "@/lib/browser-read";
export default function GeneratedContentBank({gameId,games,demo}:{gameId:string;games:Game[];demo:boolean}){
 const [snapshot,setSnapshot]=useState<StudioSnapshot|null>(null);const [error,setError]=useState("");const [busy,setBusy]=useState<string|null>(null);
 const load=useCallback(async()=>{setSnapshot(await browserRead<StudioSnapshot>("/api/content-studio"));setError("");},[]);
 useEffect(()=>{if(demo)return;let active=true;const controller=new AbortController();void browserRead<StudioSnapshot>("/api/content-studio",controller.signal).then(b=>{if(active)setSnapshot(b);}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;controller.abort();};},[demo]);
 const videos=(snapshot?.productions||[]).filter(p=>p.state==="ready"&&p.videoUrl&&(gameId==="all"||p.gameId===gameId));
 return <section className="content-engine" aria-label="Generated content bank"><div className="studio-heading"><h2>Generated videos</h2><button className="button" disabled={!!busy||demo} onClick={()=>void load().catch(e=>setError(e.message))}>Refresh videos</button></div>
 {error&&<p role="alert">{error}</p>}{!snapshot&&!demo&&!error&&<p role="status">Loading generated videos…</p>}{(snapshot||demo)&&!videos.length&&<p className="studio-secondary">Finished Content Studio videos appear here.</p>}
 <div className="studio-bank-grid">{videos.map(video=><article className="studio-video" key={video.id}><small>{games.find(g=>g.id===video.gameId)?.title||"Archived game"}</small><h3>{video.idea.title}</h3><video controls playsInline preload="metadata" src={video.videoUrl} aria-label={video.idea.title}/><div className="studio-video-actions"><a className="button" href={`/api/content-studio/${video.id}/download`}>Download MP4</a><label>Planning date · Dubai<input type="date" aria-label={`Bank planning date for ${video.idea.title}`} value={video.plannedDate||""} disabled={busy===video.id} onChange={async e=>{if(busy)return;setBusy(video.id);try{const r=await fetch("/api/content-studio",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"plan",productionId:video.id,date:e.target.value||null})});const b=await r.json();if(!r.ok)throw Error(b.error||"Unable to save date.");await load();}catch(err){setError(err instanceof Error?err.message:"Unable to save date.");}finally{setBusy(null);}}}/></label></div><details><summary>Source and script</summary><p>Run {video.id}</p><p>Source revision {video.sourceRevision}</p>{video.sourceUrl&&<a href={video.sourceUrl} target="_blank" rel="noreferrer">Game source</a>}<p>Script {video.scriptId||"Unavailable"}</p><pre className="studio-bank-script">{video.scriptText||"No saved script for this older output."}</pre></details></article>)}</div>
 </section>;
}
