"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Globe } from "cobe";
import { countrySegments } from "@/lib/country-segments";
import "./audience-globe.css";

type Props = { countries: { name: string; count: number }[]; unit?: string; onSelectCountry?: (code: string | null) => void };
export default function AudienceGlobe({ countries, unit = "sessions", onSelectCountry }: Props) {
  const segments = useMemo(() => countrySegments(countries), [countries]);
  const canvas = useRef<HTMLCanvasElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const instance = useRef<Globe | null>(null);
  const orientation = useRef({ phi: 0.35, theta: 0.18 });
  const dragging = useRef<number | null>(null);
  const [rotate, setRotate] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [ready, setReady] = useState(false);
  const selection = segments.countries.find(c => c.code === selected);
  useEffect(() => {
    let closed = false, observer: ResizeObserver | undefined;
    const element = canvas.current;
    const contextLost = () => setUnavailable(true);
    element?.addEventListener("webglcontextlost", contextLost);
    void import("cobe").then(({ default: createGlobe }) => {
      if (closed || !canvas.current || !host.current) return;
      try {
        const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
        const width = Math.max(1, host.current.clientWidth);
        instance.current = createGlobe(canvas.current, { width, height: width, devicePixelRatio: dpr, ...orientation.current, dark: 0, diffuse: 1.1, mapSamples: 12000, mapBrightness: 5, baseColor: [0.85,0.88,0.86], markerColor: [0.19,0.41,0.31], glowColor: [1,1,1], opacity: 1, markers: [] });
        if (!instance.current || !(canvas.current.getContext("webgl2") || canvas.current.getContext("webgl"))) throw new Error("WebGL unavailable");
        setReady(true); setUnavailable(false);
        observer = new ResizeObserver(([entry]) => { const size = entry.contentRect.width; instance.current?.update({width:size,height:size}); });
        observer.observe(host.current);

      } catch { setUnavailable(true); }
    }).catch(() => { if (!closed) setUnavailable(true); });
    return () => { closed=true; observer?.disconnect(); instance.current?.destroy(); instance.current=null; element?.removeEventListener("webglcontextlost",contextLost); };
  }, []);
  useEffect(() => {
    const markers = segments.countries.map(country => ({id:country.code.toLowerCase(),location:country.location,size:0.025 + Math.sqrt(country.count/Math.max(1,segments.total))*0.075,color: country.code === selected ? [0.12,0.25,0.18] as [number,number,number] : [0.25,0.52,0.38] as [number,number,number]}));
    if (ready) instance.current?.update({markers});
  }, [segments, selected, ready]);
  useEffect(() => {
    if (!rotate || !ready || unavailable) return;
    let frame = 0;
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const step = () => {
      if (document.hidden || media.matches) return;
      if (dragging.current === null) { orientation.current.phi += 0.002; instance.current?.update(orientation.current); }
      frame = requestAnimationFrame(step);
    };
    const restart = () => { cancelAnimationFrame(frame); step(); };
    document.addEventListener("visibilitychange",restart); media.addEventListener("change",restart); step();
    return () => { cancelAnimationFrame(frame); document.removeEventListener("visibilitychange",restart); media.removeEventListener("change",restart); };
  },[rotate,ready,unavailable]);
  function choose(code: string | null) {
    setSelected(code); onSelectCountry?.(code); setRotate(false);
    const country = segments.countries.find(c => c.code===code);
    if (country) { orientation.current={phi:Math.PI*1.5-country.location[1]*Math.PI/180,theta:country.location[0]*Math.PI/180}; instance.current?.update(orientation.current); }
  }
  return <section className="audience-globe" aria-label="Visitor country segments">
    <div className="globe-heading"><div><h2>Where visitors connect</h2><p>Approximate connection country · {unit}</p></div><button type="button" className="button" onClick={() => setRotate(v=>!v)} aria-pressed={rotate} disabled={unavailable}>{rotate ? "Pause globe" : "Rotate globe"}</button></div>
    <div className="globe-layout"><div className="globe-stage" ref={host}>
      <canvas ref={canvas} aria-hidden="true" style={{touchAction:"pan-y"}} onPointerDown={e=>{dragging.current=e.clientX; e.currentTarget.setPointerCapture(e.pointerId);}} onPointerMove={e=>{if(dragging.current!==null){orientation.current.phi+=(e.clientX-dragging.current)/180;dragging.current=e.clientX;instance.current?.update(orientation.current);}}} onPointerUp={()=>{dragging.current=null;}} onPointerCancel={()=>{dragging.current=null;}}/>
      {!unavailable && segments.countries.map(country=><button key={country.code} type="button" className="globe-marker" style={{positionAnchor:`--cobe-${country.code.toLowerCase()}`,opacity:`var(--cobe-visible-${country.code.toLowerCase()}, 0)`,transform:`translate(-50%,-7px) scale(var(--cobe-visible-${country.code.toLowerCase()}, 0))`} as React.CSSProperties} onClick={()=>choose(country.code)} aria-label={`${country.name}: ${country.count.toLocaleString()} ${unit}`} tabIndex={-1}><span/>{country.count.toLocaleString()}</button>)}
      {unavailable && <p className="globe-fallback" role="status">3D rendering is unavailable. All measured countries remain available in the table.</p>}
    </div><div className="globe-data">
      <div className="globe-selection" aria-live="polite"><span>{selection ? selection.name : "Shown countries"}</span><strong>{(selection?.count ?? segments.total).toLocaleString()} <small>{unit}</small></strong>{selection && <><p>{segments.total ? (selection.count/segments.total*100).toFixed(1) : "0"}% of shown {unit}</p><button type="button" className="button" onClick={()=>choose(null)}>Clear country</button></>}</div>
      <div className="globe-country-list"><table><caption>Country breakdown — select a row to inspect it on the globe</caption><thead><tr><th>Country</th><th>{unit}</th><th>Share</th></tr></thead><tbody>{segments.countries.map(country=><tr key={country.code} className={country.code===selected?"is-selected":""}><td><button type="button" onClick={()=>choose(country.code)} aria-pressed={country.code===selected}>{country.name}</button></td><td>{country.count.toLocaleString()}</td><td>{segments.total?(100*country.count/segments.total).toFixed(1):"0"}%</td></tr>)}{segments.unknown>0&&<tr><td>Unknown / unmapped</td><td>{segments.unknown.toLocaleString()}</td><td>{segments.total?(100*segments.unknown/segments.total).toFixed(1):"0"}%</td></tr>}</tbody></table>{!segments.total&&<p>No measured country data in this range. The globe contains no visitor markers.</p>}</div>
    </div></div><p className="globe-note">Markers represent country reference points, not visitor coordinates. VPNs, consent and missing hosting geography limit coverage. Selecting a country highlights this breakdown; it does not filter other reports. <a href="https://github.com/mledoze/countries" target="_blank" rel="noreferrer">Country reference data</a> · ODbL-1.0.</p>
  </section>;
}
