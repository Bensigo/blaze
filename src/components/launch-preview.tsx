"use client";

import { useState } from "react";
import { Activity, ArrowDownRight, Radar } from "lucide-react";

const stages = [
  { label: "Visits", value: "1,240", width: "100%" },
  { label: "Started a round", value: "620", width: "50%" },
  { label: "Finished a round", value: "273", width: "22%" },
];

export default function LaunchPreview() {
  const [view, setView] = useState<"players" | "watchlist">("players");

  return (
    <section id="preview" className="launch-preview" aria-label="Interactive Blaze demo">
      <div className="launch-preview-top">
        <span className="launch-preview-label"><Activity size={15} aria-hidden="true" /> WORKSPACE PREVIEW</span>
        <span className="launch-sample">Sample data</span>
      </div>
      <div className="launch-preview-toolbar">
        <div className="launch-preview-game">
          <span className="launch-game-art" aria-hidden="true">
            <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
              <ellipse cx="14" cy="14" rx="13" ry="5.6" transform="rotate(-39 14 14)" stroke="currentColor" />
              <circle cx="14" cy="14" r="6.4" fill="currentColor" />
              <circle cx="21.8" cy="5.9" r="1.7" fill="currentColor" />
            </svg>
          </span>
          <div><strong>Orbit Sprint</strong><small>Browser game</small></div>
        </div>
        <div className="launch-preview-switch" role="group" aria-label="Preview report">
          <button type="button" aria-pressed={view === "players"} aria-controls="blaze-preview-report" onClick={() => setView("players")}>Players</button>
          <button type="button" aria-pressed={view === "watchlist"} aria-controls="blaze-preview-report" onClick={() => setView("watchlist")}>Watchlist</button>
        </div>
      </div>

      <div id="blaze-preview-report" aria-live="polite">
        {view === "players" ? (
          <div className="launch-report">
            <div className="launch-report-title"><h2>Player journey</h2><span>Last 7 days</span></div>
            <ol className="launch-funnel" aria-label="Sample player journey">
              {stages.map((stage) => (
                <li key={stage.label}>
                  <div><span>{stage.label}</span><strong>{stage.value}</strong></div>
                  <span className="launch-funnel-track" aria-hidden="true"><i style={{ width: stage.width }} /></span>
                </li>
              ))}
            </ol>
            <p className="launch-report-note"><ArrowDownRight size={17} aria-hidden="true" /><span><strong>Biggest drop-off:</strong> 56% of players who started a round didn’t finish.</span></p>
          </div>
        ) : (
          <div className="launch-report">
            <div className="launch-report-title"><h2>Competitor watchlist</h2><span>Example observation</span></div>
            <div className="launch-watch-example">
              <strong>Pixel Drift</strong><span>Public listing likes</span>
              <dl><div><dt>Previous</dt><dd>1,180</dd></div><div><dt>Latest</dt><dd>1,240</dd></div><div><dt>Change</dt><dd>+60</dd></div></dl>
            </div>
            <p className="launch-report-note"><Radar size={17} aria-hidden="true" /><span>Record what a listing shows. Public likes don’t tell you how many people played.</span></p>
          </div>
        )}
      </div>
    </section>
  );
}
