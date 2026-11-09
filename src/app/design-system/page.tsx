"use client";
import { useState } from "react";
import { ArrowUpRight, Check, ChevronRight, Circle, Gamepad2, LayoutDashboard, Plus, Search, Settings2, Video } from "lucide-react";
import Link from "next/link";
import "./preview.css";

export default function DesignSystem() {
  const [tab,setTab]=useState("Overview");
  const [name,setName]=useState("");
  const [error,setError]=useState(false);
  return <div className="ds-preview">
    <aside className="ds-sidebar"><Link href="/" className="ds-logo">▦ <b>blaze.</b></Link><div className="ds-workspace"><span>B</span><div><strong>Design workspace</strong><small>Component preview</small></div></div><p className="ds-caption">Workspace</p><nav>{[[LayoutDashboard,"Overview"],[Gamepad2,"Games"],[Search,"SEO & AEO"],[Settings2,"Foundations"]].map(([Icon,label])=>{const I=Icon as typeof Video;return <button key={String(label)} className={tab===label?"is-active":""} onClick={()=>setTab(String(label))}><I size={17}/>{String(label)}</button>;})}</nav><p className="ds-side-note">Original Blaze components.<br/>Sample data only.</p></aside>
    <main className="ds-main"><header className="ds-topbar"><span>Workspace <ChevronRight size={13}/> <strong>{tab}</strong></span><Link href="/app">Open Blaze <ArrowUpRight size={14}/></Link></header>
      <div className="ds-content"><div className="ds-page-heading"><div><p className="ds-caption">BLAZE / DESIGN SYSTEM</p><h1>A clearer workspace.</h1><p>Player evidence and search insights.</p></div><button className="button primary" onClick={()=>document.getElementById("ds-input")?.focus()}><Plus size={16}/>New game</button></div>
        <section className="ds-foundations"><div><h2>Built for focus</h2><p>Neutral surfaces. Readable detail. One considered accent.</p></div><div className="ds-swatches">{["Ink","Muted","Border","Surface","Accent"].map(x=><div key={x}><i className={`ds-swatch ds-${x.toLowerCase()}`}/><span>{x}</span></div>)}</div></section>
        <section className="ds-example"><div className="ds-section-heading"><div><h2>Your games</h2></div><span className="ds-badge"><Circle size={10}/>Sample</span></div><div className="ds-table-wrap"><table><thead><tr><th>Game</th><th>Source</th><th>Search checks</th><th>Next step</th></tr></thead><tbody><tr><td><strong>Sample arcade</strong><small>Browser game</small></td><td><span className="ds-badge success"><Check size={12}/>Connected</span></td><td>3 findings</td><td><button className="button" onClick={()=>setTab("SEO & AEO")}>Review checks<ChevronRight size={14}/></button></td></tr><tr><td><strong>Sample runner</strong><small>Browser game</small></td><td><span className="ds-badge warning">Needs review</span></td><td>Not prepared</td><td><button className="button" onClick={()=>document.getElementById("ds-input")?.focus()}>Edit source</button></td></tr></tbody></table></div></section>
        <div className="ds-two-column"><section className="ds-example"><h2>Forms with a clear next step</h2><form onSubmit={e=>{e.preventDefault();setError(!name.trim());}}><label htmlFor="ds-input">Game name</label><input id="ds-input" value={name} onChange={e=>{setName(e.target.value);setError(false);}} placeholder="Enter a game name" aria-invalid={error} aria-describedby={error?"ds-error":"ds-hint"}/><p id={error?"ds-error":"ds-hint"} className={error?"ds-field-error":"ds-caption"}>{error?"Enter a game name to continue.":"Preview only. Nothing is saved."}</p><div className="ds-actions"><button className="button primary">Continue</button><button type="button" className="button" onClick={()=>{setName("");setError(false);}}>Cancel</button></div></form></section><section className="ds-example"><h2>Honest product states</h2><div className="ds-state"><Video size={20}/><div><strong>Search Console needs setup</strong><p>Connect an authorized property to view search observations.</p></div></div><button className="button" disabled>View search data</button><p className="ds-caption">No authorized search data connected.</p></section></div>
        <footer className="ds-preview-footer">System type · 4px spacing scale · 6–10px corners · visible keyboard focus · reduced-motion support</footer>
      </div>
    </main>
  </div>;
}
