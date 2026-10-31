"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowUpRight,
  CalendarDays,
  Clapperboard,
  Download,
  Film,
  LayoutGrid,
  List,
  Play,
  Plus,
  RefreshCw,
  Search,
  X,
} from "lucide-react";
import type {
  StudioSnapshot,
  VideoProduction,
} from "@/lib/content-studio-contract";
import type { Clip, Game, Recording } from "@/lib/types";
import { browserRead } from "@/lib/browser-read";
import InfoHint from "./info-hint";

type Asset = {
  id: string;
  kind: "generated" | "recording" | "clip";
  title: string;
  gameId: string;
  createdAt: string;
  state: string;
  videoUrl?: string;
  image?: string;
  duration?: number;
  production?: VideoProduction;
  recording?: Recording;
  clip?: Clip;
};
const date = (value: string) =>
  new Date(value).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "Asia/Dubai",
  });
const duration = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
export default function GeneratedContentBank({
  gameId,
  games,
  demo,
  recordings = [],
  clips = [],
  selectedRecording,
  onRecordingSelect,
  onCreateClip,
  onCreatePost,
  onQueueRecording,
  seekAt,
  onStudio,
}: {
  gameId: string;
  games: Game[];
  demo: boolean;
  recordings?: Recording[];
  clips?: Clip[];
  selectedRecording?: Recording | null;
  onRecordingSelect?: (recording: Recording | null) => void;
  onCreateClip?: (recording: Recording, start?: number) => void;
  onCreatePost?: (clip: Clip) => void;
  onQueueRecording?: () => void;
  seekAt?: number;
  onStudio?: () => void;
}) {
  const [snapshot, setSnapshot] = useState<StudioSnapshot | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const mutation = useRef(false);
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("newest");
  const [view, setView] = useState<"grid" | "list">("grid");
  const [selected, setSelected] = useState<Asset | null>(null);
  const [notice, setNotice] = useState("");
  const detail = useRef<HTMLElement>(null);
  const returnFocus = useRef<string | null>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const load = useCallback(async () => {
    const next = await browserRead<StudioSnapshot>("/api/content-studio");
    setSnapshot(next);
    setError("");
    return next;
  }, []);
  useEffect(() => {
    if (demo) return;
    let active = true;
    const controller = new AbortController();
    void browserRead<StudioSnapshot>("/api/content-studio", controller.signal)
      .then((b) => {
        if (active) {
          setSnapshot(b);
          setError("");
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [demo]);
  useEffect(() => {
    setSelected(null);
    setSearch("");
    setFilter("all");
    setNotice("");
  }, [gameId]);
  useEffect(() => {
    if (
      selectedRecording &&
      (gameId === "all" || selectedRecording.gameId === gameId)
    ) {
      setSelected({
        id: selectedRecording.id,
        kind: "recording",
        title: selectedRecording.title,
        gameId: selectedRecording.gameId,
        createdAt: selectedRecording.createdAt,
        state: selectedRecording.status,
        videoUrl: selectedRecording.videoUrl,
        image: selectedRecording.screenshotUrl,
        duration: selectedRecording.duration,
        recording: selectedRecording,
      });
    }
  }, [selectedRecording, gameId]);
  useEffect(() => {
    if (selected) {
      detail.current?.focus();
      detail.current?.scrollIntoView({ block: "start" });
    }
  }, [selected?.id]);
  const videos = (snapshot?.productions || []).filter(
    (p) => p.state === "ready" && p.videoUrl,
  );
  const generatedClipIds = new Set(videos.map((p) => p.clipId).filter(Boolean));
  const assets: Asset[] = [
    ...videos.map((p) => ({
      id: p.id,
      kind: "generated" as const,
      title: p.idea.title,
      gameId: p.gameId,
      createdAt: p.createdAt,
      state: p.state,
      videoUrl: p.videoUrl,
      duration: p.settings.durationSeconds,
      production: p,
    })),
    ...recordings.map((r) => ({
      id: r.id,
      kind: "recording" as const,
      title: r.title,
      gameId: r.gameId,
      createdAt: r.createdAt,
      state: r.status,
      videoUrl: r.videoUrl,
      image: r.screenshotUrl,
      duration: r.duration,
      recording: r,
    })),
    ...clips
      .filter((c) => !generatedClipIds.has(c.id))
      .map((c) => ({
        id: c.id,
        kind: "clip" as const,
        title: c.title,
        gameId: c.gameId,
        createdAt: c.createdAt,
        state: c.status,
        videoUrl: c.videoUrl,
        duration: c.end - c.start,
        clip: c,
      })),
  ].filter((a) => gameId === "all" || a.gameId === gameId);
  const gameName = (id: string) =>
    games.find((g) => g.id === id)?.title || "Archived game";
  const shown = assets
    .filter(
      (a) =>
        (filter === "all" || a.kind === filter) &&
        `${a.title} ${gameName(a.gameId)}`
          .toLowerCase()
          .includes(search.trim().toLowerCase()),
    )
    .sort((a, b) =>
      sort === "title"
        ? a.title.localeCompare(b.title)
        : sort === "oldest"
          ? Date.parse(a.createdAt) - Date.parse(b.createdAt)
          : Date.parse(b.createdAt) - Date.parse(a.createdAt),
    );
  const close = () => {
    setSelected(null);
    onRecordingSelect?.(null);
    setNotice("");
    requestAnimationFrame(() => {
      const trigger = returnFocus.current
        ? document.getElementById(returnFocus.current)
        : null;
      if (trigger) trigger.focus();
      else searchInput.current?.focus();
    });
  };
  const refresh = async () => {
    if (mutation.current) return;
    mutation.current = true;
    setBusy(true);
    try {
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to refresh videos.");
    } finally {
      mutation.current = false;
      setBusy(false);
    }
  };
  const plan = async (value: string) => {
    if (!selected?.production || mutation.current) return;
    mutation.current = true;
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/content-studio", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "plan",
          productionId: selected.id,
          date: value || null,
        }),
      });
      const b = await r.json();
      if (!r.ok) throw Error(b.error || "Unable to save date.");
      const next = await load();
      const saved = next.productions.find((p) => p.id === selected.id);
      if (saved)
        setSelected((a) =>
          a?.id === saved.id ? { ...a, production: saved } : a,
        );
      setNotice(value ? "Added to calendar" : "Removed from calendar");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to save date.");
    } finally {
      mutation.current = false;
      setBusy(false);
    }
  };
  return (
    <section className="media-library" aria-label="Generated content bank">
      {error && (
        <div className="media-error" role="alert">
          <span>{error}</span>
          <button
            className="button"
            disabled={busy}
            onClick={() => void refresh()}
          >
            Retry
          </button>
        </div>
      )}
      {selected ? (
        <section
          className="media-detail"
          ref={detail}
          tabIndex={-1}
          aria-label={`Preview ${selected.title}`}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.stopPropagation();
              close();
            }
          }}
        >
          <button className="media-back" onClick={close}>
            <ArrowLeft size={16} /> Back to library
          </button>
          <div className="media-detail-heading">
            <div>
              <span className="media-kicker">
                {gameName(selected.gameId)} ·{" "}
                {selected.kind === "generated"
                  ? "Generated video"
                  : selected.kind === "clip"
                    ? "Clip"
                    : "Recording"}
              </span>
              <h2>{selected.title}</h2>
            </div>
            {selected.production && (
              <a
                className="button primary"
                href={`/api/content-studio/${selected.id}/download`}
              >
                <Download size={15} />
                Download MP4
              </a>
            )}
            {selected.recording && onCreateClip && (
              <button
                className="button primary"
                disabled={selected.state !== "ready"}
                onClick={() => onCreateClip(selected.recording!)}
              >
                <Plus size={15} />
                Create clip
              </button>
            )}
            {selected.clip && onCreatePost && (
              <button
                className="button"
                disabled={selected.state !== "ready"}
                onClick={() => onCreatePost(selected.clip!)}
              >
                Create post draft <ArrowUpRight size={15} />
              </button>
            )}
          </div>
          <div className="media-detail-layout">
            <div className="media-player">
              {selected.videoUrl ? (
                <video
                  key={selected.id}
                  controls
                  playsInline
                  preload="metadata"
                  src={selected.videoUrl}
                  aria-label={selected.title}
                  onLoadedMetadata={(e) => {
                    if (
                      selected.kind === "recording" &&
                      selectedRecording?.id === selected.id &&
                      seekAt !== undefined
                    )
                      e.currentTarget.currentTime = seekAt;
                  }}
                />
              ) : selected.image ? (
                <img src={selected.image} alt={selected.title} />
              ) : (
                <div className="media-unavailable">
                  <Film size={32} />
                  <strong>
                    {selected.state === "failed"
                      ? "Recording failed"
                      : "Video not available yet"}
                  </strong>
                  <span>
                    {selected.recording?.error ||
                      "This item has no playable footage."}
                  </span>
                </div>
              )}
            </div>
            <aside className="media-inspector">
              <h3>Details</h3>
              <dl>
                <div>
                  <dt>Game</dt>
                  <dd>{gameName(selected.gameId)}</dd>
                </div>
                <div>
                  <dt>Created</dt>
                  <dd>{date(selected.createdAt)}</dd>
                </div>
                <div>
                  <dt>Duration</dt>
                  <dd>
                    {selected.duration
                      ? duration(selected.duration)
                      : "Pending"}
                  </dd>
                </div>
                <div>
                  <dt>Status</dt>
                  <dd className="media-state" data-state={selected.state}>
                    {selected.state}
                  </dd>
                </div>
                {selected.production && (
                  <div>
                    <dt>Format</dt>
                    <dd>{selected.production.settings.aspectRatio}</dd>
                  </div>
                )}
                {selected.recording?.mode === "fixture" && (
                  <div>
                    <dt>Data</dt>
                    <dd>Controlled fixture</dd>
                  </div>
                )}
              </dl>
              {selected.production && (
                <div className="media-calendar">
                  <label htmlFor="bank-planning-date">
                    <CalendarDays size={15} /> Add to calendar{" "}
                    <InfoHint label="About calendar dates">
                      Planning date in Dubai. Download and post manually; this
                      does not publish content.
                    </InfoHint>
                  </label>
                  <input
                    id="bank-planning-date"
                    type="date"
                    aria-label={`Bank planning date for ${selected.title}`}
                    value={selected.production.plannedDate || ""}
                    disabled={busy}
                    onChange={(e) => void plan(e.target.value)}
                  />
                  <span role="status">
                    {busy ? "Saving…" : notice || "Planning only · Dubai"}
                  </span>
                </div>
              )}
              {selected.production && (
                <details className="media-source">
                  <summary>Source and script</summary>
                  <p>Run {selected.id}</p>
                  <p>Source revision {selected.production.sourceRevision}</p>
                  {selected.production.sourceUrl && (
                    <a
                      href={selected.production.sourceUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Game source <ArrowUpRight size={13} />
                    </a>
                  )}
                  <p>Script {selected.production.scriptId || "Unavailable"}</p>
                  <pre>
                    {selected.production.scriptText ||
                      "No saved script for this older output."}
                  </pre>
                </details>
              )}
            </aside>
          </div>
          {!!selected.recording?.observations?.length && (
            <section className="media-observations">
              <h3>
                Observations{" "}
                <InfoHint label="About recording observations">
                  Notes from this run. Hypotheses require human validation.
                </InfoHint>
              </h3>
              {selected.recording.observations.map((o, i) => (
                <button
                  key={i}
                  className="observation"
                  disabled={selected.state !== "ready" || !onCreateClip}
                  onClick={() => onCreateClip?.(selected.recording!, o.at)}
                >
                  <span>{duration(o.at)}</span>
                  <div>
                    <strong>{o.type}</strong>
                    <p>{o.text}</p>
                  </div>
                  <small>Use highlight</small>
                </button>
              ))}
            </section>
          )}
        </section>
      ) : (
        <>
          <div className="media-toolbar">
            <div className="media-tabs" role="group" aria-label="Media type">
              {(
                [
                  ["all", "All media"],
                  ["generated", "Generated"],
                  ["recording", "Recordings"],
                  ["clip", "Clips"],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  aria-pressed={filter === value}
                  onClick={() => setFilter(value)}
                >
                  {label}
                  <span>
                    {value === "all"
                      ? assets.length
                      : assets.filter((a) => a.kind === value).length}
                  </span>
                </button>
              ))}
            </div>
            <div className="media-toolbar-actions">
              <button
                className="icon-button"
                aria-label="Refresh videos"
                disabled={busy || demo}
                onClick={() => void refresh()}
              >
                <RefreshCw size={16} className={busy ? "media-spinning" : ""} />
              </button>
              {onQueueRecording && (
                <button className="button" onClick={onQueueRecording}>
                  <Plus size={15} />
                  New recording
                </button>
              )}
            </div>
          </div>
          <div className="media-filters">
            <label className="media-search">
              <Search size={16} />
              <input
                ref={searchInput}
                type="search"
                aria-label="Search media"
                placeholder="Search your library…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              {search && (
                <button aria-label="Clear search" onClick={() => setSearch("")}>
                  <X size={14} />
                </button>
              )}
            </label>
            <label className="media-sort">
              <span className="sr-only">Sort media</span>
              <select value={sort} onChange={(e) => setSort(e.target.value)}>
                <option value="newest">Newest first</option>
                <option value="oldest">Oldest first</option>
                <option value="title">Title A–Z</option>
              </select>
            </label>
            <div className="media-view" role="group" aria-label="Media layout">
              <button
                aria-label="Grid view"
                aria-pressed={view === "grid"}
                onClick={() => setView("grid")}
              >
                <LayoutGrid size={16} />
              </button>
              <button
                aria-label="List view"
                aria-pressed={view === "list"}
                onClick={() => setView("list")}
              >
                <List size={17} />
              </button>
            </div>
          </div>
          {!snapshot && !demo && !error && (
            <p className="media-loading" role="status">
              Loading generated videos…
            </p>
          )}
          {shown.length ? (
            <div className={`media-assets is-${view}`}>
              {shown.map((asset) => (
                <button
                  className="media-card"
                  id={`media-asset-${asset.kind}-${asset.id}`}
                  key={`${asset.kind}:${asset.id}`}
                  onClick={(e) => {
                    returnFocus.current = e.currentTarget.id;
                    setSelected(asset);
                  }}
                  aria-label={`Open ${asset.title}`}
                >
                  <div className="media-cover">
                    {asset.image ? (
                      <img src={asset.image} alt="" loading="lazy" />
                    ) : asset.videoUrl ? (
                      <video
                        src={asset.videoUrl}
                        muted
                        playsInline
                        preload="metadata"
                        aria-hidden="true"
                        tabIndex={-1}
                      />
                    ) : (
                      <Clapperboard size={28} strokeWidth={1.2} />
                    )}
                    {asset.videoUrl && (
                      <span className="media-play">
                        <Play size={17} fill="currentColor" />
                      </span>
                    )}
                    {!!asset.duration && (
                      <span className="media-duration">
                        {duration(asset.duration)}
                      </span>
                    )}
                    {asset.state !== "ready" && (
                      <span
                        className="media-asset-state"
                        data-state={asset.state}
                      >
                        {asset.state}
                      </span>
                    )}
                  </div>
                  <div className="media-card-copy">
                    <div className="media-card-kind">
                      {asset.kind === "generated"
                        ? "Generated video"
                        : asset.kind === "clip"
                          ? "Clip"
                          : "Recording"}
                      {asset.recording?.mode === "fixture" ? " · Fixture" : ""}
                    </div>
                    <h3>{asset.title}</h3>
                    <p>
                      {gameName(asset.gameId)}
                      <span>·</span>
                      {date(asset.createdAt)}
                    </p>
                  </div>
                  <ArrowUpRight size={16} className="media-card-arrow" />
                </button>
              ))}
            </div>
          ) : !snapshot && !demo && !error ? (
            <div className="media-skeleton" aria-hidden="true">
              {[0, 1, 2].map((id) => (
                <div key={id}>
                  <span />
                  <i />
                  <i />
                </div>
              ))}
            </div>
          ) : (
            <div className="media-empty">
              <div className="media-empty-icon">
                <Film size={27} strokeWidth={1.3} />
              </div>
              <h2>
                {error && !assets.length
                  ? "Library unavailable"
                  : search
                    ? "No matching media"
                    : filter === "all"
                      ? "Your content starts here"
                      : `No ${filter === "generated" ? "generated videos" : filter === "recording" ? "recordings" : "clips"} yet`}
              </h2>
              <p>
                {error && !assets.length
                  ? "Retry loading to see your generated videos."
                  : search
                    ? "Try another title or game."
                    : filter === "clip"
                      ? "Open a ready recording to create a clip."
                      : "Finished videos and gameplay recordings live in this library."}
              </p>
              {search ? (
                <button className="button" onClick={() => setSearch("")}>
                  Clear search
                </button>
              ) : (
                !error &&
                onStudio && (
                  <button className="button primary" onClick={onStudio}>
                    Open Content Studio <ArrowUpRight size={15} />
                  </button>
                )
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}
