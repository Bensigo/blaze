"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowUpRight, Check, Copy, FileText } from "lucide-react";

type Guide = {
  id: string; title: string; detail: string; source: string;
  headings: { id: string; title: string; level: number }[];
  content: ReactNode;
};

export function CopyDocumentation({ text, label = "Copy code", className = "" }: { text: string; label?: string; className?: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  return <><button type="button" className={`dev-copy ${className}`} onClick={async () => {
    clearTimeout(timer.current);
    try { await navigator.clipboard.writeText(text); setState("copied"); }
    catch { setState("failed"); }
    timer.current = setTimeout(() => setState("idle"), 2500);
  }} aria-label={state === "copied" ? `${label}: copied` : label}>
    {state === "copied" ? <Check size={15}/> : <Copy size={15}/>}
    <span aria-live="polite">{state === "copied" ? "Copied" : state === "failed" ? "Copy manually below" : label}</span>
  </button>{state === "failed" ? <label className="dev-copy-fallback">Select and copy this text<textarea aria-label={`Manual copy: ${label}`} readOnly value={text} rows={5} onFocus={event => event.currentTarget.select()}/></label> : null}</>;
}

export function DocumentationCode({ text, language, children }: { text: string; language: string; children: ReactNode }) {
  return <div className="dev-code"><div className="dev-code-toolbar"><span>{language}</span><CopyDocumentation text={text} label={`Copy ${language} example`}/></div><pre tabIndex={0}>{children}</pre></div>;
}

export default function DeveloperGuide({ guides, instruction }: { guides: Guide[]; instruction: string }) {
  const [active, setActive] = useState(guides[0].id);
  const [fragment, setFragment] = useState("");
  useEffect(() => {
    const sync = () => {
      const hash = window.location.hash.slice(1);
      const guide = guides.find(item => hash === item.id || hash.startsWith(`${item.id}-`));
      if (guide) setActive(guide.id);
      setFragment(hash);
    };
    sync(); window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, [guides]);
  useEffect(() => {
    if (!fragment) return;
    document.getElementById(fragment)?.scrollIntoView({ block: "start" });
  }, [active, fragment]);
  const current = guides.find(guide => guide.id === active) || guides[0];
  return <div className="developer-site">
    <a className="dev-skip" href="#developer-content">Skip to documentation</a>
    <header className="dev-header"><Link className="dev-brand" href="/" aria-label="Blaze home"><span className="blaze-mark" aria-hidden="true"><i/><i/><i/><i/></span><strong>blaze.</strong><span className="dev-brand-label">Developers</span></Link><nav aria-label="Developer navigation"><a href="/developers.md"><FileText size={14}/> Markdown</a><Link href="/app">Workspace <ArrowUpRight size={14}/></Link></nav></header>
    <div className="dev-intro"><div><p className="dev-eyebrow">BROWSER SDK · V1</p><h1>Integrate the Blaze SDK</h1><p>Add consented player analytics to your web game.</p></div><div className="dev-agent-action"><CopyDocumentation text={instruction} label="Copy agent instruction" className="dev-copy-primary"/><span>Give it to Claude Code, Codex or your developer.</span></div></div>
    <div className="dev-reader">
      <aside className="dev-index"><nav aria-label="SDK guides">{guides.map(guide => <a key={guide.id} href={`#${guide.id}`} aria-current={active === guide.id ? "page" : undefined}><strong>{guide.title}</strong><span>{guide.detail}</span></a>)}</nav><div className="dev-on-this-page"><span>ON THIS PAGE</span><nav aria-label="On this page">{current.headings.map(heading => <a key={heading.id} href={`#${heading.id}`} className={heading.level === 3 ? "dev-index-nested" : undefined}>{heading.title}</a>)}</nav></div><a className="dev-source" href={current.source}>View source Markdown <ArrowUpRight size={13}/></a></aside>
      <main id="developer-content" className="dev-article"><div className="dev-mobile-guides"><label htmlFor="developer-guide-select">Guide</label><select id="developer-guide-select" value={active} onChange={event => { window.location.hash = event.target.value; }}>{guides.map(guide => <option value={guide.id} key={guide.id}>{guide.title}</option>)}</select><a href={current.source}>Markdown <ArrowUpRight size={13}/></a></div>{guides.map(guide => <section key={guide.id} id={guide.id} hidden={active !== guide.id} className="dev-document"><div className="dev-prose">{guide.content}</div><footer className="dev-document-footer"><p>Keep this guide with the integration. Use the registered game’s public SDK configuration.</p><a href={guide.source}>Read this guide as Markdown <ArrowUpRight size={14}/></a></footer></section>)}</main>
    </div>
    <footer className="dev-footer"><span>Blaze SDK v1 · public documentation</span><Link href="/app">Open your workspace <ArrowUpRight size={14}/></Link></footer>
  </div>;
}
