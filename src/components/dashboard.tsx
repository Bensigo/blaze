"use client";
import GameSourceEditor from "./game-source-editor";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  Activity,
  ArrowDownRight,
  ArrowRight,
  BarChart3,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  Clock3,
  ExternalLink,
  Gamepad2,
  LayoutDashboard,
  Link2,
  LoaderCircle,
  LogOut,
  Menu,
  MoreHorizontal,
  Play,
  Plus,
  Search,
  Settings2,
  Sparkles,
  Users,
  X,
} from "lucide-react";
import dynamic from "next/dynamic";
import GameConnections from "./game-connections";
import InfoHint from "./info-hint";
import MostPlayedGames from "./most-played-games";
import {dashboardHref,readDashboardLocation,type DashboardView} from "@/lib/dashboard-location";
const GameArchiveControls = dynamic(() => import("./game-archive-controls"));
const AccountSettings = dynamic(() => import("./account-settings"), { loading: () => <p role="status">Loading account settings…</p> });
const DiscoveryReview = dynamic(() => import("./discovery-review").then(module => module.DiscoveryReview), { loading: () => <p role="status">Loading search review…</p> });
import type {
  Analytics,
  Finding,
  Measurement,
  MeasurementMetrics,
  Game,
  SessionSummary,
  SessionCapture,
  TelemetryEvent,
  WorkspaceSnapshot,
} from "@/lib/types";

const PlayerAnalytics = dynamic(() => import("./player-analytics"), { loading: () => <div className="analytics-loading" role="status">Loading analytics…</div> });
const SiteHealth = dynamic(() => import("./forever-health"), { loading: () => <p role="status">Loading site diagnostics…</p> });

type GameImportMetadata = { url: string; title: string; description: string; image: string; genre: string; metadataStatus: string; manifestSource?: { url: string; observedAt: string; sha256: string; formatVersion: 1 }; pageSource?: { url: string; observedAt: string; sha256: string } };
type GameImportState = { status: "idle" | "waiting" | "loading" | "ready" | "error"; input: string; metadata?: GameImportMetadata; error?: string };

type Page = DashboardView;
type Modal =
  | "game"
  | "connection"
  | "measurement"
  | null;
type InvestigationEvidence = { eventId: string; name: string; timestamp: string; replay?: { captureId: string; offsetSeconds: number; segment?: number } };
type InvestigationMatch = { session: SessionSummary; evidence: InvestigationEvidence };
type InvestigationState = { kind: "heatmap" | "dropoff"; title: string; loading: boolean; error?: string; results: InvestigationMatch[]; hasMore: boolean; windowStart?: string; windowEnd?: string };
const nav: { id: Page; label: string; icon: typeof Activity }[] = [
  { id: "overview", label: "Dashboard", icon: LayoutDashboard },
  { id: "games", label: "Games", icon: Gamepad2 },
  { id: "analytics", label: "Engagement", icon: BarChart3 },
  { id: "acquisition", label: "Acquisition", icon: BarChart3 },
  { id: "retention", label: "Retention", icon: BarChart3 },
  { id: "audience", label: "Audience", icon: Users },
  { id: "site", label: "Site health", icon: Activity },
  { id: "sessions", label: "Sessions", icon: Users },
  { id: "discovery", label: "SEO & AEO", icon: Search },
  { id: "research", label: "Findings & changes", icon: Search },
];
const fmt = (n: number | undefined) => (n ?? 0).toLocaleString();
const shortDate = (v?: string) =>
  v
    ? new Date(v).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : "—";
const dateTime = (v?: string) =>
  v
    ? new Date(v).toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : "Not scheduled";
const captureTime = (v: string) => new Date(v).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", second: "2-digit" });
const timecode = (n: number) =>
  `${Math.floor(n / 60)}:${String(Math.floor(n % 60)).padStart(2, "0")}`;
const label = (v: string) =>
  v.replaceAll("_", " ").replace(/^\w/, (c) => c.toUpperCase());
const eventLabel = (name: string) => name === "ui_click" ? "UI click" : label(name);
function manifestAddress(input: string) {
  try {
    const url = new URL(input);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return "";
    url.search = ""; url.hash = "";
    url.pathname = `${url.pathname.replace(/\/+$/, "")}/forever.json`;
    return url.href;
  } catch { return ""; }
}
const gameName = (games: Game[], id: string) =>
  games.find((g) => g.id === id)?.title || "Unknown game";
function captureMessage(status?: SessionCapture["status"], demo = false, missingVideo = false) {
  if (demo) return status === "unsupported"
    ? "Example status: capture unsupported. No player video was recorded."
    : "Example session: no player video was recorded.";
  if (missingVideo) return "The capture is marked ready, but playback is unavailable.";
  switch (status) {
    case "pending": return "Capture is pending; footage is not available yet.";
    case "unsupported": return "Capture was unsupported by this browser or canvas.";
    case "failed": return "Capture failed; no playable footage is available.";
    case "cancelled": return "Capture was cancelled or consent was withdrawn.";
    case "expired": return "Capture has expired and its footage is no longer available.";
    case "not_sampled": return "This session was not selected for capture.";
    case "quota_reached": return "The daily capture limit was reached.";
    default: return "No player capture was recorded for this session.";
  }
}
function Status({ value }: { value: string }) {
  return (
    <span className={`status status-${value}`}>
      <span /> {label(value)}
    </span>
  );
}
function Empty({
  title,
  detail,
  action,
}: {
  title: string;
  detail: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty-icon">
        <Sparkles size={18} />
      </div>
      <strong>{title}</strong>
      <p>{detail}</p>
      {action}
    </div>
  );
}
function Button({
  children,
  onClick,
  variant = "secondary",
  disabled = false,
  type = "button",
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: "primary" | "secondary" | "ghost" | "danger";
  disabled?: boolean;
  type?: "button" | "submit";
}) {
  return (
    <button
      type={type}
      className={`button ${variant}`}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}
function SectionHead({
  title,
  detail,
  action,
}: {
  title: string;
  detail?: string;
  action?: ReactNode;
}) {
  return (
    <div className="section-head">
      <div>
        <h2>{title}</h2>
        {detail && <p>{detail}</p>}
      </div>
      {action}
    </div>
  );
}
function Media({
  src,
  title,
  video = false,
  startAt,
}: {
  src?: string;
  title: string;
  video?: boolean;
  startAt?: number;
}) {
  return (
    <div className="media">
      {src ? (
        video ? (
          <video
            key={`${src}-${startAt ?? 0}`}
            controls
            preload="metadata"
            src={src}
            onLoadedMetadata={(e) => {
              if (startAt !== undefined)
                e.currentTarget.currentTime = Math.min(
                  startAt,
                  e.currentTarget.duration || startAt,
                );
            }}
          />
        ) : (
          <img src={src} alt={title} />
        )
      ) : (
        <div className="media-placeholder">
          <Gamepad2 size={30} />
          <span>No media yet</span>
        </div>
      )}
    </div>
  );
}
function ModalShell({
  title,
  detail,
  onClose,
  children,
}: {
  title: string;
  detail?: string;
  onClose: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    const fn = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", fn);
    return () => window.removeEventListener("keydown", fn);
  }, [onClose]);
  return (
    <div className="overlay" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="modal"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <div>
            <h2>{title}</h2>
            {detail && <p>{detail}</p>}
          </div>
          <button aria-label="Close" className="icon-button" onClick={onClose}>
            <X size={19} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
function Field({
  label: field,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <label className="field">
      <span>{field}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}

export default function Dashboard() {
  const [googleConfigured, setGoogleConfigured] = useState<boolean | null>(null);
  const [authNotice, setAuthNotice] = useState("");
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [snapshotScope, setSnapshotScope] = useState("");
  const [snapshot, setSnapshot] = useState<WorkspaceSnapshot | null>(null),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [page, setPage] = useState<Page>("overview"),
    [selectedGame, setSelectedGame] = useState("all"),
    [period, setPeriod] = useState("7"),
    [mobileNav, setMobileNav] = useState(false),
    [modal, setModal] = useState<Modal>(null);
  const [chosenGame, setChosenGame] = useState<Game | null>(null);
  const mainWorkspace=useRef<HTMLElement>(null);
  const initialSearch=useRef("");
  const availableGameIds=useRef<string[]>([]);
  availableGameIds.current=(snapshot?.games||[]).map(game=>game.id);
  const [locationReady,setLocationReady]=useState(false);
  useEffect(()=>{
    if(!snapshot){setLocationReady(false);return;}
    if(locationReady)return;
    const location=readDashboardLocation(initialSearch.current,availableGameIds.current);
    setPage(location.page);setSelectedGame(location.gameId);setPeriod(location.days);
    window.history.replaceState(null,"",dashboardHref(location));
    setLocationReady(true);
  },[snapshot,locationReady]);
  useEffect(()=>{
    if(!locationReady)return;
    const href=dashboardHref({page,gameId:selectedGame,days:period});
    if(window.location.pathname+window.location.search+window.location.hash!==href)window.history.pushState(null,"",href);
  },[page,selectedGame,period,locationReady]);
  useEffect(()=>{
    const back=()=>{
      if(window.location.pathname!=="/app")return;
      initialSearch.current=window.location.search;
      if(!locationReady)return;
      const location=readDashboardLocation(window.location.search,availableGameIds.current);
      window.history.replaceState(null,"",dashboardHref(location));
      setPage(location.page);setSelectedGame(location.gameId);setPeriod(location.days);setMobileNav(false);
    };
    window.addEventListener("popstate",back);
    return()=>window.removeEventListener("popstate",back);
  },[locationReady]);
  useEffect(()=>{
    if(!locationReady)return;
    window.scrollTo({top:0,left:0,behavior:"auto"});
    mainWorkspace.current?.focus({preventScroll:true});
  },[page,selectedGame,locationReady]);
  const navigationPanel=useRef<HTMLElement>(null);
  const navigationTrigger=useRef<HTMLButtonElement>(null);
  useEffect(()=>{
    if(!mobileNav)return;
    const previousOverflow=document.body.style.overflow;
    document.body.style.overflow="hidden";
    const controls=()=>Array.from(navigationPanel.current?.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],[tabindex="0"]')||[]).filter(el=>el.offsetParent!==null);
    controls()[0]?.focus();
    const keyboard=(event:KeyboardEvent)=>{
      if(event.key==="Escape"){event.preventDefault();setMobileNav(false);}
      if(event.key==="Tab"){const items=controls();const first=items[0],last=items.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}}
    };
    document.addEventListener("keydown",keyboard);
    return()=>{document.body.style.overflow=previousOverflow;document.removeEventListener("keydown",keyboard);navigationTrigger.current?.focus();};
  },[mobileNav]);
  const [investigation, setInvestigation] = useState<InvestigationState | null>(null);
  const investigationRequest = useRef(0);
  const [eventFilter, setEventFilter] = useState("all");
  const [sessionEvidence, setSessionEvidence] = useState<InvestigationEvidence | null>(null);
  const [evidenceReplayAvailable, setEvidenceReplayAvailable] = useState(false);
  const [chosenFinding, setChosenFinding] = useState<Finding | null>(null);
  const [chosenSession, setChosenSession] = useState<SessionSummary | null>(null),
    [sessionEvents, setSessionEvents] = useState<TelemetryEvent[]>([]),
    [sessionCapture, setSessionCapture] = useState<SessionCapture | null>(null),
    [sessionCaptures, setSessionCaptures] = useState<SessionCapture[]>([]),
    [sessionCoverage, setSessionCoverage] = useState<{ recordedSeconds: number; gaps: { startAt: string; endAt: string; reason: string }[]; limitation: string } | null>(null),
    [sessionLoading, setSessionLoading] = useState(false),
    [sessionError, setSessionError] = useState(""),
    [eventsTruncated, setEventsTruncated] = useState(false);
  const [sessionPageData, setSessionPageData] = useState<{
    scope: string; cursor: string; sessions: SessionSummary[]; total: number;
    limit: number; nextCursor?: string;
  } | null>(null);
  const [sessionCursors, setSessionCursors] = useState<(string | null)[]>([null]);
  const [sessionPageIndex, setSessionPageIndex] = useState(0);
  const [sessionPageLoading, setSessionPageLoading] = useState(false);
  const [sessionPageError, setSessionPageError] = useState("");
  const sessionPageRequest = useRef(0);
  const workspaceRequest = useRef(0);
  const sessionVideo = useRef<HTMLVideoElement>(null);
  const pendingSegmentSeek = useRef<{ id: string; offset: number } | null>(null);
  const sessionRequest = useRef(0);
  const formError = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (error && modal) formError.current?.scrollIntoView({ block: "nearest" });
  }, [error, modal]);
  const [origin, setOrigin] = useState("");
  const [localTimeZone, setLocalTimeZone] = useState("");
  const [draft, setDraft] = useState({
    url: "",
    title: "",
    image: "",
    genre: "",
    gameId: "",
    accountId: "",
    provider: "search_console",
    token: "",
    refreshToken: "",
    label: "",
    origins: "",
    resourceOrigins: "",
    webSocketOrigins: "",
    frameUrls: "",
    captureEnabled: false,
    canvasSelector: "",
    surfaceReviewed: false,
    sampleRate: "0.1",
    maxDurationSeconds: "30",
    retentionDays: "1",
    maxCapturesPerDay: "25",
    masks: "[]",
    note: "",
    releaseVersion: "", releaseDescription: "", releaseEvidenceUrl: "", releaseEffectiveAt: "",
    baselineStart: "", baselineEnd: "", followupStart: "", followupEnd: "",
  });
  const [gameImport, setGameImport] = useState<GameImportState>({ status: "idle", input: "" });
  const [importRetry, setImportRetry] = useState(0);
  useEffect(() => {
    const input = draft.url.trim();
    if (modal !== "game" || chosenGame || !manifestAddress(input)) { setGameImport({ status: "idle", input }); return; }
    const controller = new AbortController();
    setGameImport({ status: "waiting", input });
    const timer = window.setTimeout(() => {
      setGameImport({ status: "loading", input });
      void fetch("/api/actions", { method: "POST", headers: { "Content-Type": "application/json" }, signal: controller.signal, body: JSON.stringify({ action: "inspect_game", url: input }) })
        .then(async response => {
          const data = await response.json();
          if (!response.ok) throw new Error(data.error || "The game details could not be imported.");
          if (typeof data.metadata?.title !== "string") throw new Error("The import response is incomplete. Try again.");
          if (!controller.signal.aborted) setGameImport({ status: "ready", input, metadata: data.metadata });
        })
        .catch(error => { if (!controller.signal.aborted) setGameImport({ status: "error", input, error: error instanceof Error ? error.message : "The game details could not be imported." }); });
    }, 700);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [draft.url, modal, chosenGame, importRetry]);
  const refresh = useCallback(
    async (game = selectedGame, demo = snapshot?.demo, days = period) => {
      const request = ++workspaceRequest.current;
      try {
        const query = new URLSearchParams({ days });
        if (game !== "all") query.set("gameId", game);
        const res = await fetch(`${demo ? "/api/demo" : "/api/workspace"}?${query}`, { cache: "no-store", signal: AbortSignal.timeout(20000) });
        if (request !== workspaceRequest.current) return;
        if (res.status === 401 && !demo) {
          sessionRequest.current++;
          sessionPageRequest.current++;
          setChosenSession(null);
          setSnapshot(null);
          setError("");
          return;
        }
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Could not load workspace");
        if (request !== workspaceRequest.current) return;
        setSnapshotScope(`${demo ? "demo" : "workspace"}:${game}:${days}`);
        setAuthNotice("");
        setSnapshot(data);
        setUpdatedAt(new Date());
        setError("");
      } catch (e) {
        if (request === workspaceRequest.current) setError(e instanceof Error && ["TimeoutError","AbortError"].includes(e.name) ? "Workspace took too long to respond. Retry loading." : e instanceof Error ? e.message : "Could not load workspace");
      } finally {
        if (request === workspaceRequest.current) setLoading(false);
      }
    },
    [selectedGame, snapshot?.demo, period],
  );
  useEffect(() => {
    setOrigin(window.location.origin);
    setLocalTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC");
    const params = new URLSearchParams(window.location.search);
    initialSearch.current=window.location.search;
    const authResult = params.get("auth");
    if (authResult === "failed") setAuthNotice("Google sign-in did not finish. Please try again.");
    if (authResult === "setup") setAuthNotice("Google sign-in is not available yet.");
    void fetch("/api/auth/config", { cache: "no-store", signal: AbortSignal.timeout(15000) })
      .then(async (res) => {
        if (!res.ok) throw new Error("Unable to check sign-in availability");
        const config = await res.json();
        setGoogleConfigured(config.googleConfigured === true);
      })
      .catch(() => setGoogleConfigured(null));
    void refresh();
  }, []); // Initial workspace or sign-in state.
  useEffect(() => {
    if (snapshot) void refresh(selectedGame, snapshot.demo);
  }, [selectedGame, period]);
  const sessionScope = `${snapshot?.demo ? "demo" : "workspace"}:${selectedGame}:${period}`;
  const currentSessionScope = useRef(sessionScope);
  currentSessionScope.current = sessionScope;
  useEffect(() => {
    sessionPageRequest.current++;
    setSessionCursors([null]);
    setSessionPageIndex(0);
    setSessionPageData(null);
    setSessionPageLoading(false);
    setSessionPageError("");
  }, [sessionScope]);
  useEffect(() => {
    if (!snapshot || snapshot.demo) return;
    const tick = () => {
      if (document.visibilityState === "visible")
        void refresh(selectedGame, false);
    };
    const timer = window.setInterval(tick, 30000);
    document.addEventListener("visibilitychange", tick);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [snapshot?.demo, selectedGame, period, refresh]);
  const action = async (payload: Record<string, unknown>, close = true) => {
    if (snapshot?.demo) {
      setNotice("Example workspace is read-only. Sign in to make changes.");
      return false;
    }
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/actions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.status === 401) {
        workspaceRequest.current++;
        sessionPageRequest.current++;
        sessionRequest.current++;
        setChosenSession(null);
        setModal(null);
        setSnapshot(null);
        return false;
      }
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Action failed");
      if (close) setModal(null);
      await refresh();
      if (payload.action === "add_game" && typeof data.game?.id === "string") {
        setSelectedGame(data.game.id);
        setPage("overview");
        setNotice("Game imported. Install its SDK to start receiving player events.");
      } else setNotice("Changes saved.");
      return data;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Action failed");
      return false;
    } finally {
      setBusy(false);
    }
  };
  const showDemo = async () => {
    setSelectedGame("all");
    setPeriod("7");
    setPage("overview");
    setMobileNav(false);
    setChosenSession(null);
    setLoading(true);
    await refresh("all", true, "7");
  };
  const loginDev = async () => {
    setBusy(true);
    try {
      const r = await fetch("/api/auth/dev", { method: "POST" });
      if (!r.ok) throw new Error("Local sign-in unavailable");
      await refresh("all", false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sign-in failed");
    } finally {
      setBusy(false);
    }
  };
  const changePage = (p: Page) => {
    if(p===page){window.scrollTo({top:0,left:0,behavior:"auto"});mainWorkspace.current?.focus({preventScroll:true});}
    setPage(p);
    setMobileNav(false);
    sessionRequest.current++;
    setChosenSession(null);
  };
  const closeSession = () => {
    sessionRequest.current++;
    setChosenSession(null);
  };
  const openSession = async (s: SessionSummary, evidence?: InvestigationEvidence) => {
    setEventFilter("all");
    const request = ++sessionRequest.current;
    setChosenSession(s);
    setSessionEvidence(evidence || null);
    setEvidenceReplayAvailable(false);
    setSessionEvents([]);
    setSessionCapture(null);
    setSessionCaptures([]);
    setSessionCoverage(null);
    pendingSegmentSeek.current = null;
    setSessionError("");
    setEventsTruncated(false);
    if (snapshot?.demo) { setSessionLoading(false); return; }
    setSessionLoading(true);
    try {
      const query = new URLSearchParams({ gameId: s.gameId });
      const r = await fetch(`/api/sessions/${encodeURIComponent(s.id)}?${query}`, { cache: "no-store" });
      if (r.status === 401) {
        if (request === sessionRequest.current) { workspaceRequest.current++; sessionPageRequest.current++; setChosenSession(null); setSnapshot(null); }
        return;
      }
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Unable to load session");
      if (request === sessionRequest.current) {
        setSessionEvents(d.events || []);
        setEventsTruncated(d.eventsTruncated === true);
        const captures: SessionCapture[] = Array.isArray(d.captures) ? d.captures : d.capture ? [d.capture] : [];
        const replay = evidence?.replay;
        const matched = replay && captures.find((capture) => capture.id === replay.captureId && capture.status === "ready" && !!capture.videoUrl && !!capture.recordedAt && capture.durationSeconds !== undefined && replay.offsetSeconds >= 0 && replay.offsetSeconds <= capture.durationSeconds && Math.abs((Date.parse(evidence.timestamp) - Date.parse(capture.recordedAt)) / 1000 - replay.offsetSeconds) < 0.1);
        if (matched && replay) pendingSegmentSeek.current = { id: matched.id, offset: replay.offsetSeconds };
        setEvidenceReplayAvailable(!!matched);
        setSessionCapture(matched || d.capture || null);
        setSessionCaptures(captures);
        setSessionCoverage(d.coverage || null);
      }
    } catch (e) {
      if (request === sessionRequest.current) setSessionError(e instanceof Error ? e.message : "Unable to load session");
    } finally {
      if (request === sessionRequest.current) setSessionLoading(false);
    }
  };
  const navigateSessionPage = async (index: number, cursor: string | null, cursors: (string | null)[]) => {
    const request = ++sessionPageRequest.current;
    setSessionPageError("");
    if (cursor === null) {
      setSessionPageIndex(index);
      setSessionCursors(cursors);
      setSessionPageData(null);
      setSessionPageLoading(false);
      return;
    }
    setSessionPageLoading(true);
    try {
      const query = new URLSearchParams({ days: period, limit: "100", cursor });
      if (selectedGame !== "all") query.set("gameId", selectedGame);
      const res = await fetch(`/api/sessions?${query}`, { cache: "no-store" });
      if (request !== sessionPageRequest.current || sessionScope !== currentSessionScope.current) return;
      if (res.status === 401) {
        workspaceRequest.current++;
        sessionRequest.current++;
        setChosenSession(null);
        setSnapshot(null);
        return;
      }
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Unable to load sessions");
      if (request !== sessionPageRequest.current || sessionScope !== currentSessionScope.current) return;
      setSessionPageData({ ...data, scope: sessionScope, cursor });
      setSessionPageIndex(index);
      setSessionCursors(cursors);
    } catch (e) {
      if (request === sessionPageRequest.current) setSessionPageError(e instanceof Error ? e.message : "Unable to load sessions");
    } finally {
      if (request === sessionPageRequest.current) setSessionPageLoading(false);
    }
  };
  const resetDraft = () => {
    setDraft({
      url: "",
      title: "",
      image: "",
      genre: "",
      gameId: selectedGame === "all" ? "" : selectedGame,
      accountId: "",
      provider: "search_console",
      token: "",
      refreshToken: "",
      label: "",
      origins: "",
      resourceOrigins: "",
      webSocketOrigins: "",
      frameUrls: "",
      captureEnabled: false,
      canvasSelector: "",
      surfaceReviewed: false,
      sampleRate: "0.1",
      maxDurationSeconds: "30",
      retentionDays: "1",
      maxCapturesPerDay: "25",
      masks: "[]",
      note: "",
      releaseVersion: "", releaseDescription: "", releaseEvidenceUrl: "", releaseEffectiveAt: "",
      baselineStart: "", baselineEnd: "", followupStart: "", followupEnd: "",
    });
  };
  const openModal = (m: Modal) => {
    setError("");
    resetDraft();
    setChosenGame(null);
    setModal(m);
  };
  const startMeasurement = (f: Finding) => {
    resetDraft();
    setError("");
    setChosenFinding(f);
    setModal("measurement");
  };
  const editGame = (g: Game) => {
    setError("");
    setChosenGame(g);
    setDraft((d) => ({
      ...d,
      url: g.url,
      title: g.title,
      image: g.image,
      genre: g.genre,
      origins: g.origins.join("\n"),
      resourceOrigins: (g.networkPolicy?.resourceOrigins || []).join("\n"),
      webSocketOrigins: (g.networkPolicy?.webSocketOrigins || []).join("\n"),
      frameUrls: (g.networkPolicy?.frameUrls || []).join("\n"),
      captureEnabled: g.capture?.enabled || false,
      canvasSelector: g.capture?.canvasSelector || "",
      surfaceReviewed: g.capture?.surfaceReviewed || false,
      sampleRate: String(g.capture?.sampleRate ?? 0.1),
      maxDurationSeconds: String(g.capture?.maxDurationSeconds ?? 30),
      retentionDays: String(g.capture?.retentionDays ?? 1),
      maxCapturesPerDay: String(g.capture?.maxCapturesPerDay ?? 25),
      masks: JSON.stringify(g.capture?.masks || [], null, 2),
    }));
    setModal("game");
  };
  const games = snapshot?.games || [],
    analytics = snapshot?.analytics;
  const controlledGame=(game:Game)=>{try{const url=new URL(game.url);return game.metadataStatus==='Controlled fixture manifest'||(url.origin===origin&&url.pathname.startsWith('/fixture/'));}catch{return false;}};
  const filteredGames =
    selectedGame === "all" ? (page === "games" ? games.filter(g=>g.foreverCatalogue?.state!=="retired"&&!controlledGame(g)) : games) : games.filter((g) => g.id === selectedGame);
  const featuredGame = filteredGames[0];
  const findings = (snapshot?.findings || []).filter(
    (x) => selectedGame === "all" || x.gameId === selectedGame,
  );
  const sessions = analytics?.sessionsList || [];
  const sessionScopeReady = snapshotScope === sessionScope;
  const activeSessionPage = sessionPageData?.scope === sessionScope && sessionPageIndex > 0 ? sessionPageData : null;
  const shownSessions = activeSessionPage?.sessions || sessions;
  const sessionTotal = activeSessionPage?.total ?? analytics?.sessionPage?.total ?? sessions.length;
  const sessionLimit = activeSessionPage?.limit ?? analytics?.sessionPage?.limit ?? 100;
  const sessionNextCursor = activeSessionPage?.nextCursor ?? (sessionPageIndex === 0 ? analytics?.sessionPage?.nextCursor : undefined);
  const coverageLabels: Record<string, string> = { countries: "countries", sources: "traffic sources", devices: "devices", dropoffs: "drop-off points", campaigns: "campaigns", heatmap: "pointer bins" };
  const limitedCoverage = Object.entries(analytics?.coverage || {}).filter(([, value]) => value.shown < value.total);
  const trend = analytics?.trend || [];
  useEffect(() => { investigationRequest.current++; setInvestigation(null); }, [selectedGame, period, analytics?.windowEnd, snapshot?.demo]);
  const investigate = async (kind: "heatmap" | "dropoff", title: string, filters: Record<string, string>) => {
    if (!snapshot || snapshot.demo || selectedGame === "all" || !analytics?.windowEnd || !sessionScopeReady) return;
    const request = ++investigationRequest.current;
    setInvestigation({ kind, title, loading: true, results: [], hasMore: false });
    try {
      const params = new URLSearchParams({ kind, gameId: selectedGame, days: period, end: analytics.windowEnd, ...filters });
      const response = await fetch(`/api/investigation?${params}`, { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not load supporting sessions");
      if (request === investigationRequest.current) setInvestigation({ kind, title, loading: false, results: data.results || [], hasMore: !!data.hasMore, windowStart: data.windowStart, windowEnd: data.windowEnd });
    } catch (e) {
      if (request === investigationRequest.current) setInvestigation({ kind, title, loading: false, results: [], hasMore: false, error: e instanceof Error ? e.message : "Could not load supporting sessions" });
    }
  };
  const title =
    nav.find((n) => n.id === page)?.label ||
    (page === "connections" ? "Connections" : page === "account" ? "Account settings" : page === "discovery" ? "Search & answers" : "Setup & help");
  const formSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (modal === "game") {
      if (!chosenGame && (gameImport.status !== "ready" || gameImport.input !== draft.url.trim())) {
        setError("Load the game details before adding the game.");
        return;
      }
      let masks: { x: number; y: number; width: number; height: number }[] = [];
      if (chosenGame) {
        try {
          const parsed: unknown = JSON.parse(draft.masks);
          if (!Array.isArray(parsed) || parsed.length > 8 || !parsed.every((m) =>
            m && typeof m === "object" && ["x", "y", "width", "height"].every((k) => typeof m[k] === "number" && Number.isFinite(m[k])) &&
            m.x >= 0 && m.y >= 0 && m.width > 0 && m.height > 0 && m.x + m.width <= 1 && m.y + m.height <= 1
          )) throw new Error();
          masks = parsed;
        } catch {
          setError("Masks must be a JSON array of up to 8 normalized rectangles within the canvas.");
          return;
        }
      }
      await action(
        chosenGame
          ? {
              action: "update_game",
              id: chosenGame.id,
              expectedSourceUrl: chosenGame.url,
              expectedSourceRevision: chosenGame.sourceUrlRevision || null,
              title: draft.title,
              image: draft.image,
              genre: draft.genre,
              origins: draft.origins
                .split("\n")
                .map((x) => x.trim())
                .filter(Boolean),
              networkPolicy: {
                resourceOrigins: draft.resourceOrigins.split("\n").map((x) => x.trim()).filter(Boolean),
                webSocketOrigins: draft.webSocketOrigins.split("\n").map((x) => x.trim()).filter(Boolean),
                frameUrls: draft.frameUrls.split("\n").map((x) => x.trim()).filter(Boolean),
              },
              capture: {
                enabled: draft.captureEnabled,
                canvasSelector: draft.canvasSelector.trim(),
                surfaceReviewed: draft.surfaceReviewed,
                sampleRate: Number(draft.sampleRate),
                maxDurationSeconds: Number(draft.maxDurationSeconds),
                retentionDays: Number(draft.retentionDays),
                maxCapturesPerDay: Number(draft.maxCapturesPerDay),
                masks,
              },
            }
          : {
              action: "add_game",
              url: draft.url.trim(),
            },
      );
    }
    else if (modal === "measurement" && chosenFinding) {
      const values = [draft.releaseEffectiveAt, draft.baselineStart, draft.baselineEnd, draft.followupStart, draft.followupEnd];
      if (values.some((value) => !value || !Number.isFinite(new Date(value).getTime()))) { setError("Enter valid release and comparison times."); return; }
      const [effectiveAt, baselineStart, baselineEnd, followupStart, followupEnd] = values.map((value) => new Date(value).toISOString());
      await action({
        action: "start_measurement", findingId: chosenFinding.id, gameId: chosenFinding.gameId, note: draft.note,
        release: { version: draft.releaseVersion, description: draft.releaseDescription, evidenceUrl: draft.releaseEvidenceUrl, effectiveAt },
        baselineWindow: { start: baselineStart, end: baselineEnd }, followupWindow: { start: followupStart, end: followupEnd },
      });
    }
    else if (modal === "connection")
      await action({
        action: "save_connection",
        provider: "search_console",
        label: draft.label,
        token: draft.token,
        accountId: draft.accountId || undefined,
        refreshToken: draft.refreshToken || undefined,
      });
  };
  if (loading)
    return (
      <div className="initial-loading">
        <LoaderCircle className="spin" size={22} /> Loading workspace
      </div>
    );
  if (!snapshot && error)
    return <main className="workspace-unavailable"><Brand/><h1>Workspace could not load</h1><p role="alert">{error}</p><Button variant="primary" onClick={()=>{setError("");setLoading(true);void refresh();}}>Retry loading</Button></main>;
  if (!snapshot)
    return (
      <div className="signin">
        <div className="signin-brand">
          <Brand /> <span>Workspace</span>
        </div>
        <main>
          <div className="signin-mark">
            <Gamepad2 size={29} />
          </div>
          <p className="eyebrow">BLAZE</p>
          <h1>
            Know what happens
            <br />
            after play begins.
          </h1>
          <p>
            Bring player analytics and search insights into one place.
          </p>
          {authNotice && <div className="alert error" role="alert">{authNotice}</div>}
          {googleConfigured ? (
            <a className="button primary sign-button" href="/api/auth/google">
              Continue with Google <ArrowRight size={16} />
            </a>
          ) : (
            <>
              <Button variant="primary" disabled>
                {googleConfigured === null ? "Google sign-in unavailable" : "Google sign-in not configured"}
              </Button>
              <p className="signin-setup">
                {googleConfigured === null ? "Sign-in availability could not be confirmed. Please try again later." : "Google sign-in has not been configured for this workspace yet."}
              </p>
            </>
          )}
          {process.env.NODE_ENV === "development" && process.env.NEXT_PUBLIC_LOCAL_DEV === "true" && (
            <Button onClick={loginDev} disabled={busy}>
              Local development sign in
            </Button>
          )}
          <button className="text-link" onClick={showDemo}>
            Explore an example workspace <ArrowRight size={14} />
          </button>
          {error && <div className="alert error">{error}</div>}
          <div className="signin-note">
            Google sign-in requires a configured application. The example
            workspace is read-only.
          </div>
        </main>
      </div>
    );
  return (
    <div className="app-shell">
      <aside id="workspace-navigation" ref={navigationPanel} role={mobileNav?"dialog":undefined} aria-modal={mobileNav?true:undefined} aria-label={mobileNav?"Workspace navigation":undefined} className={`sidebar ${mobileNav ? "open" : ""}`}>
        <div className="side-top">
          <Brand />
          <button
            className="icon-button side-close"
            aria-label="Close navigation"
            onClick={() => setMobileNav(false)}
          >
            <X size={19} />
          </button>
        </div>
        <div className="workspace-switch">
          <div className="workspace-avatar">W</div>
          <div>
            <strong>{snapshot.workspace.name}</strong>
            <span>{snapshot.demo ? "Example workspace" : "Workspace"}</span>
          </div>
        </div>
        <nav aria-label="Workspace navigation">
          {[
            { title: "Analytics", items: nav.slice(0, 8) },
            { title: "Discovery", items: nav.slice(8) },
          ].map((group) => (
            <div className="nav-group" key={group.title}>
              <div className="nav-label">{group.title}</div>
              {group.items.map((n) => (
                <button
                  key={n.id}
                  onClick={() => changePage(n.id)}
                  className={`nav-item ${page === n.id ? "active" : ""}`}
                  aria-current={page===n.id?"page":undefined}
                >
                  <n.icon size={17} />
                  <span>{n.label}</span>
                </button>
              ))}
            </div>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="nav-label">Settings</div>
          <button
            className={`nav-item ${page === "connections" ? "active" : ""}`}
            onClick={() => changePage("connections")}
          >
            <Link2 size={17} /> Connections
          </button>
          <button className={`nav-item ${page === "account" ? "active" : ""}`} onClick={() => changePage("account")}><Settings2 size={17}/> Account settings</button>
          <button
            className={`nav-item ${page === "help" ? "active" : ""}`}
            onClick={() => changePage("help")}
          >
            <CircleHelp size={17} /> Setup & help
          </button>
          <div className="side-user">
            <div className="user-avatar">{snapshot.user?.name?.[0] || "E"}</div>
            <div>
              <strong>{snapshot.user?.name || "Example workspace"}</strong>
              <span>{snapshot.user?.email || "Read-only"}</span>
            </div>
            <button
              className="icon-button"
              aria-label="Sign out"
              onClick={async () => {
                if (snapshot.demo) {
                  workspaceRequest.current++;
                  setSnapshot(null);
                  return;
                }
                await fetch("/api/auth/logout", { method: "POST" });
                workspaceRequest.current++;
                sessionPageRequest.current++;
                setSnapshot(null);
              }}
            >
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </aside>
      {mobileNav && (
        <div className="nav-backdrop" onClick={() => setMobileNav(false)} />
      )}
      <div className="main-shell">
        <header className="topbar">
          <div className="topbar-left">
            <button
              className="icon-button mobile-menu"
              ref={navigationTrigger}
              aria-controls="workspace-navigation"
              aria-expanded={mobileNav}
              onClick={() => setMobileNav(true)}
              aria-label="Open navigation"
            >
              <Menu size={20} />
            </button>
            <strong>{title}</strong>
          </div>
          <div className="topbar-right">
            <span className="system-dot" />{" "}
            <span className="top-status">
              {snapshot.demo
                ? "Example data"
                : snapshot.system.database
                  ? "Workspace connected"
                  : "Database unavailable"}
            </span>
            {!snapshot.demo && (
              <button
                className="refresh-control"
                onClick={() => void refresh()}
                title="Refresh workspace"
                aria-label="Refresh workspace"
              >
                {updatedAt
                  ? `Updated ${updatedAt.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", second: "2-digit" })}`
                  : "Refresh"}{" "}
                ↻
              </button>
            )}
            {page !== "account" && <Button variant="primary" onClick={() => openModal("game")}>
              <Plus size={16} /> Add game
            </Button>}
          </div>
        </header>
        {process.env.NODE_ENV === "development" && process.env.NEXT_PUBLIC_BLAZE_CONTROLLED_FIXTURE === "true" && (
          <div className="demo-banner" role="status">
            <strong>Controlled fixture data</strong>
            <span>Local acceptance workspace · scripted tests, not audience activity.</span>
          </div>
        )}
        {snapshot.demo && (
          <div className="demo-banner">
            <strong>Example workspace</strong>
            <span>
              Illustrative data, not your games or analytics. Changes are
              disabled.
            </span>
            <button onClick={() => { workspaceRequest.current++; setSnapshot(null); }}>
              Sign in <ArrowRight size={14} />
            </button>
          </div>
        )}
        {error && (
          <div className="toast error" role="alert">
            {error}
            <button onClick={() => setError("")}>
              <X size={15} />
            </button>
          </div>
        )}
        {notice && (
          <div className="toast" role="status">
            {notice}
            <button onClick={() => setNotice("")}>
              <X size={15} />
            </button>
          </div>
        )}
        <main ref={mainWorkspace} tabIndex={-1} className="main-content">
          {snapshot.system.eventRetentionDays && Number(period) > snapshot.system.eventRetentionDays ? <p className="data-note" role="status">Raw events are retained for {snapshot.system.eventRetentionDays} days. This {period}-day report can be incomplete for earlier dates; first-seen records do not restore deleted activity.</p> : null}
          {page !== "account" && <div className="page-heading">
            <div>
              <div className="page-title-line"><h1>{title}</h1><InfoHint label={`About ${title}`}>{pageDescriptions[page]}</InfoHint></div>
            </div>
            {page !== "connections" && page !== "help" && page !== "research" && page !== "site" && (
              <div className="filters">
                <label>
                  <span className="sr-only">Filter by game</span>
                  <Gamepad2 size={15} />
                  <select
                    value={selectedGame}
                    onChange={(e) => setSelectedGame(e.target.value)}
                  >
                    <option value="all">All games</option>
                    {games.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.title}
                      </option>
                    ))}
                  </select>
                  <ChevronDown size={14} />
                </label>
                {["overview","analytics","acquisition","retention","audience","sessions"].includes(page) && <label>
                  <span className="sr-only">Filter by date</span>
                  <CalendarDays size={15} />
                  <select
                    value={period}
                    onChange={(e) => setPeriod(e.target.value)}
                  >
                    <option value="7">Last 7 days</option>
                    <option value="14">Last 14 days</option>
                    <option value="30">Last 30 days</option>
                  </select>
                  <ChevronDown size={14} />
                </label>}
                {["overview","analytics","acquisition","retention","audience"].includes(page) && (snapshot.demo ? <button className="button" disabled title="Export is unavailable in the example workspace">Export CSV</button> : <a className="button" href={`/api/analytics/export?${new URLSearchParams({ days: period, ...(selectedGame === "all" ? {} : { gameId: selectedGame }) })}`}>Export CSV</a>)}
              </div>
            )}
          </div>}
          {page === "site" && <SiteHealth demo={snapshot.demo}/>}
          {page === "overview" && sessionScopeReady && <MostPlayedGames analytics={snapshot.analytics} games={games} />}
          {(["overview", "analytics", "acquisition", "retention", "audience"].includes(page)) && (sessionScopeReady ? <PlayerAnalytics
            analytics={analytics} games={games} gameId={selectedGame} days={period} demo={snapshot.demo} detailed view={page === "analytics" ? "engagement" : page === "acquisition" || page === "retention" || page === "audience" ? page : "overview"}
            onChooseGame={setSelectedGame} onAddGame={() => openModal("game")} onSetup={() => changePage("help")}
            onAnalytics={() => changePage("analytics")} onSessions={() => changePage("sessions")} onOpenSession={openSession}
            onDropoff={name => void investigate("dropoff", name, { dropoff: name })}
            onClearEvidence={() => { investigationRequest.current++; setInvestigation(null); }}
            onBin={(context, bx, by, sessionId) => {
              if (sessionId) {
                const selected = sessions.find(item => item.gameId === selectedGame && item.id === sessionId);
                if (selected) void openSession(selected);
                else setNotice("Open this session from the Sessions list to inspect its events.");
              } else void investigate("heatmap", `Pointer bin ${bx + 1}, ${by + 1}`, { ...context, bx: String(bx), by: String(by) });
            }}
            supporting={investigation ? <InvestigationResults state={investigation} onOpen={openSession} /> : undefined}
          /> : <div className="analytics-loading" role="status">Loading this game and date range…</div>)}
          {page === "games" && (
            <>
              <SectionHead
                title="Your games"
                detail="Current games. Historical entries and controlled fixtures remain available through the game selector."
              />
              {filteredGames.length ? (
                <div className="games-list">
                  {filteredGames.map((g) => (
                    <div className="game-row" key={g.id}>
                      <div className="game-art">
                        <Media src={g.image} title={g.title} />
                      </div>
                      <div className="game-info">
                        <h3>{g.title}</h3>
                        <a href={g.url} target="_blank" rel="noreferrer">
                          {g.url} <ExternalLink size={12} />
                        </a>
                        <p>{g.description || "No description provided."}</p>
                        {!snapshot.demo && <GameSourceEditor game={g} onSaved={() => { void refresh(); }}/>}
                        {g.manifestSource && <a className="game-manifest-source" href={g.manifestSource.url} target="_blank" rel="noreferrer">Imported from manifest <ExternalLink size={11}/></a>}
                        <span className="tag">
                          {g.genre || "Web game"}
                        </span>{" "}
                        <span className="muted">
                          Added {shortDate(g.createdAt)}
                        </span>
                      </div>
                      <div className="game-actions">
                        <Button onClick={() => { setSelectedGame(g.id); changePage("discovery"); }}>Search &amp; answers</Button>
                        <Button
                          onClick={() => {
                            setSelectedGame(g.id);
                            changePage("analytics");
                          }}
                        >
                          Analytics <ArrowRight size={14} />
                        </Button>
                        <details className="game-more-actions"><summary>More actions</summary><div><Button onClick={() => editGame(g)}>Edit</Button><Button onClick={() => setSelectedGame(g.id)}>Game profile</Button><Button
                          onClick={() => {
                            setSelectedGame(g.id);
                            changePage("help");
                          }}
                        >
                          SDK setup
                        </Button></div></details>
                      </div>
                    </div>
                  ))}
                  {selectedGame !== "all" && <GameProfile gameId={selectedGame} demo={snapshot.demo} />}
                </div>
              ) : (
                <Empty
                  title="No games added"
                  detail="Add a game to start collecting player activity."
                  action={
                    <Button onClick={() => openModal("game")}>
                      <Plus size={15} /> Add game
                    </Button>
                  }
                />
              )}
            </>
          )}
          {page === "games" && <GameArchiveControls games={games} demo={snapshot.demo} onUpdated={async () => { setSelectedGame("all"); await refresh("all", false); }}/>}
          {page === "discovery" && <>
            <SectionHead title={games.find(game => game.id === selectedGame)?.title || "Choose a game"} detail="Review public page observations, search visibility and suggested fixes." action={<Button onClick={() => changePage("games")}>Back to games</Button>}/>
            {snapshot.demo ? <Empty title="Sign in to review your game" detail="Public checks are unavailable in the example workspace."/> : selectedGame === "all" ? <Empty title="Choose one game" detail="Select a game above to read its cached observations or run a public-page review."/> : <DiscoveryReview key={selectedGame} gameId={selectedGame}/>}
          </>}
          {page === "sessions" && (
            <>
              <SectionHead
                title="Session explorer"
                detail="Select a session to inspect its events and consented capture."
              />
              {sessionPageError && <p className="error-text" role="alert">{sessionPageError}</p>}
              {sessionScopeReady ? <SessionsTable
                sessions={shownSessions}
                games={games}
                onSelect={openSession}
              /> : <p className="table-empty">Loading sessions…</p>}
              {sessionScopeReady && !snapshot.demo && analytics?.sessionPage && (
                <div className="session-pagination" aria-label="Session pages">
                  <span aria-live="polite">{sessionPageLoading ? "Loading sessions…" : shownSessions.length ? `Showing ${fmt(sessionPageIndex * sessionLimit + 1)}–${fmt(sessionPageIndex * sessionLimit + shownSessions.length)} of ${fmt(sessionTotal)} sessions` : `Showing 0 of ${fmt(sessionTotal)} sessions`}</span>
                  <div>
                    <Button disabled={sessionPageLoading || sessionPageIndex === 0} onClick={() => {
                      const index = sessionPageIndex - 1;
                      void navigateSessionPage(index, sessionCursors[index], sessionCursors);
                    }}>Previous</Button>
                    <Button disabled={sessionPageLoading || !sessionNextCursor} onClick={() => {
                      if (!sessionNextCursor) return;
                      const index = sessionPageIndex + 1;
                      const cursors = [...sessionCursors.slice(0, index), sessionNextCursor];
                      void navigateSessionPage(index, sessionNextCursor, cursors);
                    }}>Next</Button>
                  </div>
                </div>
              )}
            </>
          )}
          {page === "research" && <><SectionHead title="Actions and measurements" detail="Track findings and compare player activity after a game change."/><Findings findings={findings} action={action} full onMeasure={startMeasurement}/><Measurements items={(snapshot.measurements || []).filter(m => selectedGame === "all" || m.gameId === selectedGame)} findings={findings}/></>}
          {page === "account" && (snapshot.demo ? <Empty title="Sign in to configure your account" detail="The example workspace does not store credentials."/> : <AccountSettings user={snapshot.user} onSaved={async () => { await refresh(); }}/>) }
          {page === "connections" && (
            <>
              <GameConnections games={games} origin={origin} onSynced={async()=>{await refresh();}} onAdd={() => openModal("game")} onSetup={(gameId) => { setSelectedGame(gameId); changePage("help"); }} onSessions={(gameId) => { setSelectedGame(gameId); changePage("sessions"); }}/>
              <SectionHead title="Search Console" detail="Connect an authorized Search Console property to enrich search insights." action={<Button variant="primary" onClick={() => { resetDraft(); setDraft(d => ({ ...d, provider: "search_console" })); setModal("connection"); }}><Plus size={16}/> Add connection</Button>}/>
              <div className="connection-list">{snapshot.connections.filter(c => c.provider === "search_console").map(c => <div className="connection-row" key={c.id}><div className="provider-copy"><strong>{c.label}</strong><span>{c.accountId || "Property not specified"}</span></div><Status value={c.connected ? "connected" : "disconnected"}/><Button onClick={() => void action({ action: "delete_connection", id: c.id })}>Remove</Button></div>)}</div>
            </>
          )}
          {page === "help" && (
            <Help
              games={games}
              selectedGame={selectedGame}
              system={snapshot.system}
              origin={origin}
            />
          )}
        </main>
      </div>
      {chosenSession && (
        <div className="drawer-wrap">
          <div
            className="drawer-backdrop"
            onClick={closeSession}
          />
          <aside className="drawer">
            <div className="drawer-head">
              <div>
                <div className="eyebrow">SESSION INSPECTOR</div>
                <h2>{gameName(games, chosenSession.gameId)}</h2>
                <p>
                  {dateTime(chosenSession.startedAt)} · {chosenSession.device}
                </p>
              </div>
              <button
                className="icon-button"
                onClick={closeSession}
                aria-label="Close session"
              >
                <X size={19} />
              </button>
            </div>
            <div className="drawer-body">
              {sessionEvidence && <div className="evidence-context"><strong>Supporting event: {label(sessionEvidence.name)}</strong><p>{captureTime(sessionEvidence.timestamp)}</p>{!sessionLoading && <p>{sessionEvidence.replay ? evidenceReplayAvailable ? "The matching segment is selected; playback will seek when it loads." : "The previously available segment is no longer available; showing the event only." : "No saved segment covers this event; showing the event only."}</p>}</div>}
              <div className="session-stats">
                <div>
                  <span>Session span <InfoHint label="About session span">Elapsed time between recorded events; this is not active play.</InfoHint></span>
                  <strong>{timecode(chosenSession.duration)}</strong>
                </div>
                <div>
                  <span>Measured active play <InfoHint label="About active play">Foreground time with recent input after a round starts. Missing measurement remains unknown.</InfoHint></span>
                  <strong>{chosenSession.activePlaySeconds == null ? "Unknown" : timecode(chosenSession.activePlaySeconds)}</strong>
                </div>
                <div>
                  <span>Events</span>
                  <strong>{chosenSession.events}</strong>
                </div>
                <div>
                  <span>Errors</span>
                  <strong>{chosenSession.errors}</strong>
                </div>
              </div>
              <div className="session-capture">
                <div className="capture-heading">
                  <h3>Player canvas capture</h3>
                  {!sessionLoading && !sessionError && <Status value={sessionCapture?.status || chosenSession.captureStatus || "not_recorded"} />}
                </div>
                {!sessionLoading && sessionCaptures.length > 1 && <Field label="Capture segment"><select value={sessionCapture?.id || ""} onChange={(e) => { pendingSegmentSeek.current = null; setSessionCapture(sessionCaptures.find((c) => c.id === e.target.value) || null); }}>{sessionCaptures.map((capture, index) => <option key={capture.id} value={capture.id}>Segment {capture.segment === undefined ? index + 1 : capture.segment + 1} · {label(capture.status)} · {capture.recordedAt ? dateTime(capture.recordedAt) : "Start unknown"}</option>)}</select></Field>}
                {sessionCoverage && <div className="capture-coverage"><p>{timecode(sessionCoverage.recordedSeconds)} recorded across {sessionCaptures.filter((capture) => capture.status === "ready").length} available segment(s). {sessionCoverage.limitation}</p>{sessionCoverage.gaps.length > 0 && <><strong>Unrecorded gaps</strong><ul>{sessionCoverage.gaps.map((gap, index) => <li key={index}>{captureTime(gap.startAt)}–{captureTime(gap.endAt)} · {label(gap.reason)}</li>)}</ul></>}</div>}
                {sessionLoading ? <p className="muted">Loading capture…</p> : sessionError ? <p className="error-text">{sessionError}</p> : sessionCapture?.status === "ready" && sessionCapture.videoUrl ? (
                  <>
                    <video key={sessionCapture.id} ref={sessionVideo} controls preload="metadata" src={sessionCapture.videoUrl} aria-label="Player canvas capture" onLoadedMetadata={() => { if (pendingSegmentSeek.current?.id === sessionCapture.id && sessionVideo.current) { sessionVideo.current.currentTime = pendingSegmentSeek.current.offset; pendingSegmentSeek.current = null; } }} />
                    <p className="muted">Started {dateTime(sessionCapture.recordedAt || sessionCapture.createdAt)}{!sessionCapture.recordedAt && " (approximate)"} · {sessionCapture.durationSeconds === undefined ? "Duration unavailable" : timecode(sessionCapture.durationSeconds)} · {sessionCapture.width && sessionCapture.height ? `${sessionCapture.width} × ${sessionCapture.height}` : "Dimensions unavailable"} · expires {dateTime(sessionCapture.expiresAt)}</p>
                    <p className="muted">Canvas only, with configured masks; no audio or DOM. Select an event within an available segment to seek.</p>
                  </>
                ) : (
                  <p className="muted">{captureMessage(sessionCapture?.status || chosenSession.captureStatus, snapshot.demo, sessionCapture?.status === "ready")}{sessionCapture?.reason ? ` (${label(sessionCapture.reason)})` : ""}</p>
                )}
                {sessionCapture && !snapshot.demo && !["expired", "cancelled"].includes(sessionCapture.status) && (
                  <Button variant="danger" disabled={busy} onClick={() => {
                    if (window.confirm("Delete all captured segments for this session? This cannot be undone.")) {
                      void (async () => {
                        const result = await action({ action: "delete_session_capture", id: sessionCapture.id }, false);
                        if (result) await openSession(chosenSession);
                      })();
                    }
                  }}>Delete all session footage</Button>
                )}
              </div>
              <h3>Event timeline</h3>
              <p className="muted">Events in recorded order.</p>
              {sessionEvents.length > 0 && <><p className="muted">Counts in this {eventsTruncated ? "limited timeline" : "session"}: {(["ui_click", "player_action", "milestone"] as const).map((name) => `${eventLabel(name)} ${sessionEvents.filter((event) => event.name === name).length}`).join(" · ")}</p><Field label="Filter events"><select value={eventFilter} onChange={(e) => setEventFilter(e.target.value)}><option value="all">All events</option><option value="ui_click">UI clicks</option><option value="player_action">Player actions</option><option value="milestone">Milestones</option></select></Field></>}
              {!sessionLoading && <KeyEventBreakdown events={sessionEvents} truncated={eventsTruncated} />}
              {!sessionLoading && eventsTruncated && <p className="data-note">Showing the first {fmt(sessionEvents.length)} events. This timeline was limited to 5,000 events.</p>}
              {sessionLoading ? (
                <p>Loading events…</p>
              ) : sessionError ? (
                <p className="error-text">{sessionError}</p>
              ) : sessionEvents.length ? (
                <div className="timeline">
                  {sessionEvents.filter((e) => eventFilter === "all" || e.name === eventFilter).map((e, i) => (
                    <div key={e.id || i}>
                      <span className="timeline-dot" />
                      <div>
                        {(() => {
                          const timestamp = Date.parse(e.timestamp);
                          const capture = sessionCaptures.find((item) => item.status === "ready" && !!item.videoUrl && !!item.recordedAt && item.durationSeconds !== undefined && Number.isFinite(timestamp) && timestamp >= Date.parse(item.recordedAt) && timestamp <= Date.parse(item.recordedAt) + item.durationSeconds * 1000);
                          if (!capture || !capture.recordedAt) return <strong>{eventLabel(e.name)}</strong>;
                          const offset = (timestamp - Date.parse(capture.recordedAt)) / 1000;
                          return <button className="timeline-seek" type="button" onClick={() => {
                            if (sessionCapture?.id === capture.id && sessionVideo.current) sessionVideo.current.currentTime = offset;
                            else { pendingSegmentSeek.current = { id: capture.id, offset }; setSessionCapture(capture); }
                          }}>{eventLabel(e.name)} <small>Seek to {timecode(offset)} in segment {capture.segment === undefined ? sessionCaptures.indexOf(capture) + 1 : capture.segment + 1}</small></button>;
                        })()}
                        <p>{dateTime(e.timestamp)}</p>
                        {["ui_click", "player_action", "milestone"].includes(e.name) && typeof e.properties?.key === "string" ? <small>Key: {e.properties.key}{typeof e.properties.value === "number" ? ` · Value: ${e.properties.value}` : ""}</small> : e.properties && Object.keys(e.properties).length > 0 && <small>{JSON.stringify(e.properties)}</small>}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="table-empty">
                  {snapshot.demo
                    ? "Event details are unavailable in the example."
                    : "No event details available."}
                </p>
              )}
              <div className="data-note">
                Pointer coordinates show interaction density, not a semantic
                replay of the game.
              </div>
            </div>
          </aside>
        </div>
      )}
      {modal && (
        <ModalShell
          title={
            modal === "game" && chosenGame ? "Edit game" : modalTitles[modal]
          }
          detail={modalDetails[modal]}
          onClose={() => setModal(null)}
        >
            <form onSubmit={formSubmit}>
              {error && <div ref={formError} className="alert error" role="alert">{error}</div>}
              {modal === "game" && (
                <>
                  {chosenGame ? <><p>Main source URL: {chosenGame.url}</p><GameSourceEditor game={chosenGame} onSaved={() => { setModal(null); void refresh(); }}/></> : <Field label="Game page URL" hint="Blaze reads available metadata from the public game page.">
                    <input required type="url" placeholder="https://yourgame.com/my/game" value={draft.url} onChange={e => { setError(""); setDraft({ ...draft, url: e.target.value }); }} />
                  </Field>}
                  {!chosenGame && <div className="manifest-import">
                    {(gameImport.status === "waiting" || gameImport.status === "loading") && <p className="manifest-status" role="status"><LoaderCircle className="spin" size={15} /> Reading game details…</p>}
                    {gameImport.status === "error" && <div className="manifest-import-error" role="alert"><strong>Game could not be imported</strong><p>{gameImport.error}</p><button type="button" className="text-action" onClick={() => setImportRetry(value => value + 1)}>Try again <ArrowRight size={13}/></button></div>}
                    {gameImport.status === "ready" && gameImport.metadata && <div className="manifest-preview" role="status">
                      <div className="manifest-preview-head">{gameImport.metadata.image && <img src={gameImport.metadata.image} alt=""/>}<div><span><Check size={13}/> Game details found</span><h3>{gameImport.metadata.title}</h3><p>{gameImport.metadata.genre}</p></div></div>
                      <p className="manifest-description">{gameImport.metadata.description}</p>
                      {gameImport.metadata.manifestSource ? <div className="manifest-provenance"><a href={gameImport.metadata.manifestSource.url} target="_blank" rel="noreferrer">View source manifest <ExternalLink size={12}/></a><span>Version {gameImport.metadata.manifestSource.formatVersion} · checked {dateTime(gameImport.metadata.manifestSource.observedAt)}</span></div> : gameImport.metadata.pageSource && <div className="manifest-provenance"><a href={gameImport.metadata.pageSource.url} target="_blank" rel="noreferrer">View source page <ExternalLink size={12}/></a><span>Checked {dateTime(gameImport.metadata.pageSource.observedAt)}</span></div>}
                      <small>Review these details; you can edit the game after adding it.</small>
                    </div>}
                    {gameImport.status === "idle" && <p className="quiet-help">Enter a public game page URL to preview available details.</p>}
                  </div>}
                  {chosenGame && <>
                    <Field label="Title"><input required placeholder="Game title" value={draft.title} onChange={e => setDraft({ ...draft, title: e.target.value })}/></Field>
                    <Field label="Artwork URL"><input type="url" placeholder="https://…" value={draft.image} onChange={e => setDraft({ ...draft, image: e.target.value })}/></Field>
                    <Field label="Genre"><input placeholder="Game genre" value={draft.genre} onChange={e => setDraft({ ...draft, genre: e.target.value })}/></Field>
                  </>}
                  {chosenGame && (
                    <>
                      <Field
                        label="Allowed game origins"
                        hint="One origin per line, for example https://yourgame.com."
                      >
                        <textarea
                          rows={2}
                          value={draft.origins}
                          onChange={(e) =>
                            setDraft({ ...draft, origins: e.target.value })
                          }
                        />
                      </Field>
                      <div className="settings-section">
                        <h3>Human canvas capture</h3>
                        <p className="muted">Off by default. Capture also requires analytics consent and a separate, explicit recording consent from each player. Only the reviewed canvas is recorded; no audio or DOM content. Limits: 5 fps, up to 960 × 540 and 3 MiB.</p>
                        <label className="checkbox"><input type="checkbox" checked={draft.captureEnabled} onChange={(e) => setDraft({ ...draft, captureEnabled: e.target.checked })} /> Enable capture for this game</label>
                        <Field label="Unique canvas selector" hint="Select exactly one origin-clean canvas on the game page.">
                          <input value={draft.canvasSelector} required={draft.captureEnabled} onChange={(e) => setDraft({ ...draft, canvasSelector: e.target.value })} placeholder="#game-canvas" />
                        </Field>
                        <label className="checkbox"><input type="checkbox" required={draft.captureEnabled} checked={draft.surfaceReviewed} onChange={(e) => setDraft({ ...draft, surfaceReviewed: e.target.checked })} /> I reviewed the canvas for private content and configured masks where needed.</label>
                        <div className="form-grid">
                          <Field label="Sample rate" hint="0–1; default 0.1 (10%)."><input type="number" min="0" max="1" step="0.01" required value={draft.sampleRate} onChange={(e) => setDraft({ ...draft, sampleRate: e.target.value })} /></Field>
                          <Field label="Maximum duration (seconds)"><input type="number" min="1" max="30" step="1" required value={draft.maxDurationSeconds} onChange={(e) => setDraft({ ...draft, maxDurationSeconds: e.target.value })} /></Field>
                          <Field label="Retention (days)"><input type="number" min="1" max="7" step="1" required value={draft.retentionDays} onChange={(e) => setDraft({ ...draft, retentionDays: e.target.value })} /></Field>
                          <Field label="Maximum captures per day"><input type="number" min="1" max="100" step="1" required value={draft.maxCapturesPerDay} onChange={(e) => setDraft({ ...draft, maxCapturesPerDay: e.target.value })} /></Field>
                        </div>
                        <Field label="Privacy masks" hint={'JSON array of up to 8 rectangles with normalized coordinates (0–1), e.g. [{"x":0,"y":0,"width":0.2,"height":0.1}]. Masks cover these regions in black.'}>
                          <textarea rows={4} value={draft.masks} onChange={(e) => setDraft({ ...draft, masks: e.target.value })} spellCheck={false} />
                        </Field>
                      </div>
                    </>
                  )}
                </>
              )}
              {modal === "measurement" && (
                <>
                  <p className="muted">Finding: {chosenFinding?.title} · Game: {games.find((game) => game.id === chosenFinding?.gameId)?.title || chosenFinding?.gameId}</p>
                  <p>Record a change that has already shipped. Release details are owner-reported; comparisons show association, not causation.</p>
                  <Field label="Release version"><input required maxLength={500} value={draft.releaseVersion} onChange={(e) => setDraft({ ...draft, releaseVersion: e.target.value })} /></Field>
                  <Field label="Release description"><textarea required maxLength={500} rows={3} value={draft.releaseDescription} onChange={(e) => setDraft({ ...draft, releaseDescription: e.target.value })} /></Field>
                  <Field label="Release evidence URL" hint="HTTPS link to a release record, commit or other evidence."><input required type="url" pattern="https://.*" maxLength={2000} value={draft.releaseEvidenceUrl} onChange={(e) => setDraft({ ...draft, releaseEvidenceUrl: e.target.value })} /></Field>
                  <Field label="Measurement note"><textarea required rows={2} value={draft.note} onChange={(e) => setDraft({ ...draft, note: e.target.value })} /></Field>
                  <p className="data-note">Times use your browser’s local time zone ({localTimeZone || "local time"}) and are saved in UTC. Baseline must end no later than release; follow-up must begin at or after release. Each window can span at most 90 days.</p>
                  {([ ["releaseEffectiveAt", "Actual release time"], ["baselineStart", "Baseline start"], ["baselineEnd", "Baseline end"], ["followupStart", "Follow-up start"], ["followupEnd", "Follow-up end"] ] as const).map(([key, title]) => <Field key={key} label={title} hint={draft[key] && Number.isFinite(new Date(draft[key]).getTime()) ? `UTC: ${new Date(draft[key]).toISOString()}` : undefined}><input required type="datetime-local" value={draft[key]} onChange={(e) => setDraft({ ...draft, [key]: e.target.value })} /></Field>)}
                </>
              )}
              {modal === "connection" && (
                <>
                  <Field label="Connection label">
                    <input
                      required
                      value={draft.label}
                      onChange={(e) =>
                        setDraft({ ...draft, label: e.target.value })
                      }
                      placeholder="e.g. Game property"
                    />
                  </Field>
                  <Field
                    label="Token or API key"
                    hint="Stored encrypted on the server; never placed in a game page."
                  >
                    <input
                      required
                      type="password"
                      autoComplete="off"
                      value={draft.token}
                      onChange={(e) =>
                        setDraft({ ...draft, token: e.target.value })
                      }
                    />
                  </Field>
                  <Field
                    label={
                      draft.provider === "search_console"
                        ? "Search Console property URL"
                        : "Account ID (optional)"
                    }
                    hint={
                      draft.provider === "search_console"
                        ? "Enter the authorized property URL or sc-domain property identifier."
                        : undefined
                    }
                  >
                    <input
                      required={draft.provider === "search_console"}
                      value={draft.accountId}
                      onChange={(e) =>
                        setDraft({ ...draft, accountId: e.target.value })
                      }
                    />
                  </Field>
                  <Field label="Refresh token (optional)">
                    <input
                      type="password"
                      autoComplete="off"
                      value={draft.refreshToken}
                      onChange={(e) =>
                        setDraft({ ...draft, refreshToken: e.target.value })
                      }
                    />
                  </Field>
                  <div className="data-note">
                    Provide credentials from an account you are authorized to
                    use. Saving a token does not complete native OAuth or
                    required platform approval.
                  </div>
                </>
              )}
              <div className="modal-actions">
                <Button onClick={() => setModal(null)}>Cancel</Button>
                <Button
                  variant="primary"
                  type="submit"
                  disabled={
                    busy || (modal === "game" && !chosenGame && (gameImport.status !== "ready" || gameImport.input !== draft.url.trim()))
                  }
                >
                  {busy
                    ? "Saving…"
                    : modal === "game"
                      ? chosenGame
                        ? "Save changes"
                        : "Add game"
                      : modal === "connection" ? "Save connection" : "Record change"}
                </Button>
              </div>
            </form>
        </ModalShell>
      )}
    </div>
  );
}

type GameProfileData = {
  gameId: string;
  status: "queued" | "running" | "partial" | "complete" | "failed" | "not_started";
  lastRefresh: string | null;
  facts: { key: string; label: string; value: string; evidence: { source: string; url?: string; observedAt: string; recordingId?: string; at?: number; formatVersion?: number; sha256?: string } }[];
  overrides: Partial<Record<"description" | "genre" | "audience" | "rules" | "controls", string>>;
  prerequisites: string[];
};
const profileFields = ["description", "genre", "audience", "rules", "controls"] as const;
function GameProfile({ gameId, demo }: { gameId: string; demo: boolean }) {
  const [profile, setProfile] = useState<GameProfileData | null>(null);
  const [values, setValues] = useState<GameProfileData["overrides"]>({});
  const [dirty, setDirty] = useState(false);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const dirtyRef = useRef(false);
  useEffect(() => { dirtyRef.current = dirty; }, [dirty]);
  useEffect(() => {
    if (demo) return;
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch(`/api/games/${encodeURIComponent(gameId)}/profile`, { cache: "no-store" });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Could not load game profile");
        if (cancelled) return;
        setProfile(data);
        if (!dirtyRef.current) setValues(data.overrides || {});
        setError("");
      } catch (e) { if (!cancelled) setError(e instanceof Error ? e.message : "Could not load game profile"); }
    };
    setProfile(null); setDirty(false); dirtyRef.current = false; setEditing(false); setNotice("");
    void load();
    return () => { cancelled = true; };
  }, [gameId, demo]);
  const send = async (method: "POST" | "PATCH") => {
    setBusy(true); setError(""); setNotice("");
    try {
      const res = await fetch(`/api/games/${encodeURIComponent(gameId)}/profile`, {
        method, headers: { "Content-Type": "application/json" },
        body: JSON.stringify(method === "PATCH" ? { overrides: values } : {}),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not update game profile");
      if (method === "PATCH") { setDirty(false); dirtyRef.current = false; setEditing(false); setNotice("Owner details saved."); }
      else setNotice("Profile refresh queued.");
      // Remount the read loop after a write so queued work is polled.
      const get = await fetch(`/api/games/${encodeURIComponent(gameId)}/profile`, { cache: "no-store" });
      const fresh = await get.json();
      if (get.ok) { setProfile(fresh); if (method === "PATCH") setValues(fresh.overrides || {}); }
    } catch (e) { setError(e instanceof Error ? e.message : "Could not update game profile"); }
    finally { setBusy(false); }
  };
  // Refresh starts polling even when the previous investigation had finished.
  useEffect(() => {
    if (!profile || !["queued", "running"].includes(profile.status)) return;
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/games/${encodeURIComponent(gameId)}/profile`, { cache: "no-store" });
        if (res.ok) { const data = await res.json(); setProfile(data); if (!dirtyRef.current) setValues(data.overrides || {}); }
      } catch { setError("Could not refresh game profile status."); }
    }, 5000);
    return () => clearTimeout(timer);
  }, [profile, gameId]);
  if (demo) return <section className="game-profile"><h2>Game profile</h2><p>Profile investigation is unavailable in the example workspace.</p></section>;
  return <section className="game-profile">
    <div className="profile-heading"><div><h2>Game profile</h2><p>Investigation: {profile ? label(profile.status) : "Loading"} · Last refresh: {profile?.lastRefresh ? dateTime(profile.lastRefresh) : "Never"}</p></div>
      <div><Button disabled={busy || !profile || ["queued", "running"].includes(profile.status)} onClick={() => void send("POST")}>Refresh investigation</Button> <Button onClick={() => setEditing(!editing)}>{editing ? "Close editor" : "Edit owner details"}</Button></div></div>
    {error && <p className="profile-error" role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    {profile?.prerequisites.length ? <div className="profile-prerequisites"><strong>Needed to investigate</strong><ul>{profile.prerequisites.map((item) => <li key={item}>{item}</li>)}</ul></div> : null}
    {editing ? <form onSubmit={(e) => { e.preventDefault(); void send("PATCH"); }}>
      <p>Owner-entered details take precedence. Audience is a hypothesis. Clear a field to remove its override.</p>
      <div className="profile-fields">{profileFields.map((field) => <Field key={field} label={field === "audience" ? "Audience hypothesis" : label(field)}><textarea maxLength={1000} rows={2} value={values[field] || ""} onChange={(e) => { dirtyRef.current = true; setDirty(true); setValues((current) => ({ ...current, [field]: e.target.value })); }} /></Field>)}</div>
      <Button type="submit" variant="primary" disabled={busy || !dirty}>Save owner details</Button>
    </form> : <dl className="profile-details">{profileFields.filter((field) => profile?.overrides[field]).map((field) => <div key={field}><dt>{field === "audience" ? "Audience hypothesis" : label(field)} · Owner</dt><dd>{profile?.overrides[field]}</dd></div>)}</dl>}
    <h3>Observed evidence</h3><p className="muted">Each fact retains its source and observation time. Owner details above are separate overrides; an unavailable source is listed under investigation needs.</p>
    {profile?.facts.length ? <ul className="profile-facts">{profile.facts.map((fact, index) => <li key={`${fact.key}-${index}`}><strong>{fact.label}</strong><span>{fact.value}</span><small>{fact.evidence.source} · {dateTime(fact.evidence.observedAt)}{fact.evidence.formatVersion !== undefined ? ` · Format v${fact.evidence.formatVersion}` : ""}{fact.evidence.sha256 ? ` · SHA-256 ${fact.evidence.sha256}` : ""}{fact.evidence.recordingId ? ` · Recording ${fact.evidence.recordingId}${fact.evidence.at !== undefined ? ` at ${timecode(fact.evidence.at)}` : ""}` : ""}{fact.evidence.url && /^https?:\/\//i.test(fact.evidence.url) && <> · <a href={fact.evidence.url} target="_blank" rel="noreferrer">Source</a></>}</small></li>)}</ul> : <p className="muted">No observed facts available yet.</p>}
  </section>;
}

function Brand() {
  return (
    <div className="brand">
      <span className="brand-mark">
        <span />
        <span />
        <span />
        <span />
      </span>
      <span><b>blaze<span className="blaze-period">.</span></b></span>
    </div>
  );
}
const pageDescriptions: Record<Page, string> = {
  overview: "Sessions, measured play and recorded pointer activity.",
  games: "Manage the games in your workspace.",
  analytics: "Play funnels, sessions and pointer activity.",
  acquisition: "Traffic sources, campaigns and launch conversion.",
  retention: "Return cohorts for observed browser IDs.",
  audience: "Countries, devices and consented audience segments.",
  site: "Private website visits, game entry, and classified issues.",
  sessions: "Inspect individual player journeys and event sequences.",
  research: "Evidence, next steps and the result to check afterward.",
  connections: "Connect games and Search Console.",
  account: "Manage read-only agent access.",
  discovery: "Review the public page, search setup and answer content for one game.",
  help: "Get your workspace ready and understand the workflow.",
};
const modalTitles: Record<Exclude<Modal, null>, string> = {
  game: "Add a game",
  connection: "Add a connection",
  measurement: "Record a game change",
};
const modalDetails: Record<Exclude<Modal, null>, string> = {
  game: "Start with a public web game URL.",
  connection: "Add an authorized provider credential.",
  measurement: "Record what changed, then compare player activity over time.",
};
function InvestigationResults({ state, onOpen }: { state: InvestigationState; onOpen: (session: SessionSummary, evidence?: InvestigationEvidence) => void }) {
  return <section className="investigation-results" aria-label="Supporting sessions">
    <h3>{state.title} · Supporting sessions</h3>
    {state.loading ? <p className="muted">Loading sessions…</p> : state.error ? <p className="error-text" role="alert">{state.error}</p> : state.results.length ? <>
      <p className="muted">{state.windowStart && state.windowEnd ? `Window: ${captureTime(state.windowStart)} – ${captureTime(state.windowEnd)}.` : ""} {state.hasMore ? "Showing the first 50 matches; more are available." : `${fmt(state.results.length)} matching sessions.`}</p>
      <div className="investigation-list">{state.results.map(({session, evidence}) => <button key={`${session.gameId}-${session.id}-${evidence.eventId}`} type="button" onClick={() => onOpen(session, evidence)}><span><strong>{dateTime(session.startedAt)} · {session.id.slice(0, 8)}</strong><small>{label(evidence.name)} · {captureTime(evidence.timestamp)} · {evidence.replay ? "Saved segment available" : "Event only; no saved segment"}</small></span><ChevronRight size={14} /></button>)}</div>
    </> : <p className="muted">No matching sessions in this range.</p>}
  </section>;
}
function Breakdown({
  title,
  items,
}: {
  title: string;
  items: { name: string; count: number }[];
}) {
  const max = Math.max(...items.map((x) => x.count), 1);
  return (
    <div className="breakdown">
      <h3>{title}</h3>
      {items.length ? (
        items.slice(0, 5).map((x) => (
          <div key={x.name} className="breakdown-row">
            <span>{x.name || "Unknown"}</span>
            <div>
              <i style={{ width: `${(x.count / max) * 100}%` }} />
            </div>
            <strong>{fmt(x.count)}</strong>
          </div>
        ))
      ) : (
        <p className="muted">No data yet.</p>
      )}
    </div>
  );
}
function SessionsTable({
  sessions,
  games,
  onSelect,
}: {
  sessions: SessionSummary[];
  games: Game[];
  onSelect: (s: SessionSummary) => void;
}) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>SESSION</th>
            <th>GAME</th>
            <th>LOCATION / DEVICE</th>
            <th>LAST STEP</th>
            <th>EVENTS</th>
            <th>CAPTURE</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {sessions.map((s) => (
            <tr
              key={s.id}
              onClick={() => onSelect(s)}
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter") onSelect(s);
              }}
            >
              <td>
                <strong>{dateTime(s.startedAt)}</strong>
                <small>{s.id.slice(0, 8)}</small>
              </td>
              <td>{gameName(games, s.gameId)}</td>
              <td>
                {s.country || "Unknown"} <small>{s.device || "Unknown"}</small>
              </td>
              <td>{label(s.lastStep || "Unknown")}</td>
              <td>{s.events}</td>
              <td><Status value={s.captureStatus || "not_recorded"} /></td>
              <td>
                <ChevronRight size={16} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!sessions.length && (
        <p className="table-empty">No human sessions in this range.</p>
      )}
    </div>
  );
}
function Findings({
  findings,
  action,
  full = false,
  onMeasure,
  onRecording,
}: {
  findings: Finding[];
  action: (payload: Record<string, unknown>) => Promise<unknown>;
  full?: boolean;
  onMeasure?: (f: Finding) => void;
  onRecording?: (id: string, at?: number) => void;
}) {
  return findings.length ? (
    <div className="finding-list">
      {findings.map((f) => (
        <div className="finding" key={f.id}>
          <div className="finding-mark">
            <ArrowDownRight size={16} />
          </div>
          <div className="finding-copy">
            <div className="finding-title">
              <strong>{f.title}</strong>
              <span className="tag">{label(f.type)}</span>
            </div>
            <p>{f.detail}</p>
            {full && (
              <>
                <div className="evidence">
                  {f.evidence.map((e, i) =>
                    e.recordingId && onRecording ? (
                      <button
                        className="evidence-link"
                        key={i}
                        onClick={() => onRecording(e.recordingId!, e.at)}
                      >
                        {e.label}
                        {e.at !== undefined ? ` · ${timecode(e.at)}` : ""}{" "}
                        <ArrowRight size={12} />
                      </button>
                    ) : e.url ? (
                      <a key={i} href={e.url} target="_blank" rel="noreferrer">
                        {e.label} <ExternalLink size={12} />
                      </a>
                    ) : (
                      <span key={i}>
                        {e.label}
                        {e.at !== undefined ? ` · ${timecode(e.at)}` : ""}
                      </span>
                    ),
                  )}
                </div>
                <div className="finding-footer">
                  <span>
                    {label(f.priority)} priority · {shortDate(f.createdAt)}
                  </span>
                  <div className="finding-actions">
                    {onMeasure && (
                      <Button onClick={() => onMeasure(f)}>
                        Record game change
                      </Button>
                    )}
                    <select
                      aria-label={`Status for ${f.title}`}
                      value={f.status}
                      onChange={(e) =>
                        action({
                          action: "update_finding",
                          id: f.id,
                          status: e.target.value,
                        })
                      }
                    >
                      <option value="open">Open</option>
                      <option value="in_progress">In progress</option>
                      <option value="resolved">Resolved</option>
                    </select>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      ))}
    </div>
  ) : (
    <p className="table-empty">No findings to show.</p>
  );
}
function MeasurementRow({ name, metrics }: { name: string; metrics: MeasurementMetrics }) {
  const ratio = (numerator: number, denominator: number, rate: number | null) => `${fmt(numerator)} / ${fmt(denominator)} (${rate === null ? "unknown" : `${(rate * 100).toFixed(1)}%`})`;
  return <tr><td>{name}</td><td>{fmt(metrics.players)}</td><td>{fmt(metrics.sessions)}</td><td>{fmt(metrics.starts)}</td><td>{metrics.activePlay.totalSeconds === null ? "Unknown" : timecode(metrics.activePlay.totalSeconds)} · {fmt(metrics.activePlay.measuredSessions)} / {fmt(metrics.activePlay.eligibleSessions)} measured</td><td>{ratio(metrics.completion.numerator, metrics.completion.denominator, metrics.completion.rate)}</td><td>{ratio(metrics.conversion.numerator, metrics.conversion.denominator, metrics.conversion.rate)}</td><td>{fmt(metrics.returningPlayers)}</td><td>{ratio(metrics.d1.returned, metrics.d1.eligible, metrics.d1.rate)} · cohort {fmt(metrics.d1.cohortPlayers)}</td><td>{fmt(metrics.errorSessions)}</td></tr>;
}
function KeyEventBreakdown({ events, truncated }: { events: TelemetryEvent[]; truncated: boolean }) {
  const counts = new Map<string, { name: string; key: string; count: number }>();
  for (const event of events) {
    if (!["ui_click", "player_action", "milestone"].includes(event.name) || typeof event.properties?.key !== "string") continue;
    const id = `${event.name}:${event.properties.key}`;
    const current = counts.get(id);
    if (current) current.count++;
    else counts.set(id, { name: event.name, key: event.properties.key, count: 1 });
  }
  const entries = [...counts.values()].sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
  if (!entries.length) return null;
  return <div className="data-note"><strong>Event key counts</strong><p>Counts from this {truncated ? "limited timeline" : "session"}{entries.length > 20 ? "; showing the top 20 keys" : ""}.</p><ul>{entries.slice(0, 20).map((entry) => <li key={`${entry.name}:${entry.key}`}>{eventLabel(entry.name)} · {entry.key}: {fmt(entry.count)}</li>)}</ul></div>;
}
function Measurements({
  items,
  findings,
}: {
  items: Measurement[];
  findings: Finding[];
}) {
  return (
    <div className="section-spacer">
      <SectionHead
        title="Change outcomes"
        detail="Compare the recorded windows. Differences show association, not causation."
      />
      {items.length ? (
        items.map((m) => (
          <div className="measurement" key={m.id}>
            <div className="measurement-heading"><div><strong>{m.note}</strong><p>{findings.find((f) => f.id === m.findingId)?.title || "Recorded game change"} · Recorded {dateTime(m.startedAt)}</p></div><span>{m.releaseContextStatus === "recorded" ? "Release context recorded" : m.releaseContextStatus === "invalid" ? "Release context invalid" : "Release context missing"}</span></div>
            {m.release && m.releaseContextStatus === "recorded" && <p>Owner-reported release <strong>{m.release.version}</strong> · Effective {m.release.effectiveAt} · {m.release.description} · <a href={m.release.evidenceUrl} target="_blank" rel="noreferrer">Evidence</a></p>}
            {m.releaseContextStatus !== "recorded" || !m.outcome || !m.baselineWindow || !m.followupWindow ? <p className="data-note">A reliable release comparison is unavailable. The release context or calculated outcome is missing or invalid; record a new comparison with a shipped release and explicit windows.</p> : <>
              <p className="muted">Baseline: {m.baselineWindow.start} to {m.baselineWindow.end} UTC · Follow-up: {m.followupWindow.start} to {m.followupWindow.end} UTC. Windows are start-inclusive and end-exclusive.</p>
              <p className="muted">Follow-up {m.outcome.mature ? "window ended" : "window incomplete"}; observed through {m.outcome.observedFollowupEnd || "no follow-up yet"}. D1 eligibility is evaluated separately for each cohort.</p>
              <p className="mobile-scroll-hint">Scroll sideways to see all metrics.</p>
              <div className="table-wrap" tabIndex={0}><table><thead><tr><th>PERIOD</th><th>PLAYERS</th><th>SESSIONS</th><th>STARTS</th><th>ACTIVE PLAY</th><th>COMPLETION</th><th>VISIT TO START</th><th>RETURNING PLAYERS</th><th>D1 RETURN</th><th>ERROR SESSIONS</th></tr></thead><tbody>
                <MeasurementRow name="Baseline" metrics={m.outcome.baseline} />
                <MeasurementRow name="Follow-up observed" metrics={m.outcome.followup} />
              </tbody></table></div>
              <p className="muted">Active play is a foreground, recent-input estimate; coverage shows measured / eligible sessions. Completion is completed / started sessions. Visit to start requires an ordered visit, load and start. D1 shows returned / eligible new players, with the full cohort in brackets.</p>
              {m.outcome.caveats.length > 0 && <ul>{m.outcome.caveats.map((caveat, index) => <li key={index}>{caveat}</li>)}</ul>}
              <p><strong>Next review:</strong> {m.outcome.nextAction}</p>
            </>}
          </div>
        ))
      ) : (
        <p className="table-empty">
          No game changes recorded. Choose a finding to start a comparison.
        </p>
      )}
    </div>
  );
}
function Help({
  games,
  selectedGame,
  system,
  origin,
}: {
  games: Game[];
  selectedGame: string;
  system: WorkspaceSnapshot["system"];
  origin: string;
}) {
  const game = games.find((g) => g.id === selectedGame) || games[0];
  const usage = system.databaseUsage;
  const size = (bytes: number | null) => bytes === null ? "Unavailable" : bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(2)} GiB` : `${(bytes / 1024 ** 2).toFixed(1)} MiB`;
  origin = origin || "YOUR_WORKSPACE_ORIGIN";
  const snippet = game
    ? `<script src="${origin}/sdk.js"></script>\n<script>\n  Blaze.init({ endpoint: "${origin}", sdkKey: "${game.sdkKey}", consent: false });\n  // Connect these to your actual consent controls:\n  function allowAnalytics() { Blaze.setConsent(true); }\n  function withdrawAnalytics() { Blaze.disable(); }\n  // Call at the game's real round start:\n  function startRound() { Blaze.track("round_start"); }\n</script>`
    : "";
  return (
    <div className="help-layout">
      <div>
        <SectionHead
          title="Get started"
          detail="Connect a game and start collecting consented player activity."
        />
        <div className="help-step">
          <span>01</span>
          <div>
            <h3>Add a game</h3>
            <p>
              Add a public game-page URL to import its available metadata. Metadata import does not collect gameplay events. Use a separate test workspace for controlled fixtures.
            </p>
          </div>
        </div>
        <div className="help-step">
          <span>↗</span>
          <div>
            <h3>Configure Google sign-in</h3>
            <p>
              Configure your own Google OAuth web client in Neon Auth and register the callback URL shown there in Google Cloud. Set the application’s Neon Auth URL and cookie secret, then verify sign-in with a real account. Google sign-in remains unavailable until setup is complete.
            </p>
          </div>
        </div>
        <div className="help-step">
          <span>02</span>
          <div>
            <h3>Install the SDK</h3>
            <p>
              Add the SDK to your game and configure the approved origin. Enable
              tracking only after player consent. Visits and page load are
              automatic after opt-in; connect actual starts, actions,
              completions, retries, progression and errors to game handlers.
            </p>
            <p className="data-note">Semantic <code>ui_click</code>, <code>player_action</code> and <code>milestone</code> events require the direct SDK. The embedded Frame v1 integration does not carry these events.</p>
            <p><a href="/developers" target="_blank" rel="noreferrer">Public developer guide</a> · <a href="/developers.md" target="_blank" rel="noreferrer">Markdown for agents</a></p>
            {game ? (
              <>
                <p>
                  <strong>Selected game:</strong> {game.title}
                </p>
                <dl className="sdk-configuration">
                  <div><dt>Game ID</dt><dd><code>{game.id}</code></dd></div>
                  <div><dt>Public SDK key</dt><dd><code>{game.sdkKey}</code></dd></div>
                  <div><dt>SDK endpoint</dt><dd><code>{origin}</code></dd></div>
                  <div><dt>Allowed origins</dt><dd>{game.origins.map(value => <code key={value}>{value}</code>)}</dd></div>
                </dl>
                <p className="data-note">Use the public SDK key in <code>Blaze.init</code>. The Game ID identifies API records. Never place private tokens or server credentials in game code.</p>
                <pre>{snippet}</pre>
                <p className="muted">
                  See the SDK documentation for initialization, consent and
                  event methods. Do not send input text, full DOM content or
                  secret query strings.
                </p>
              </>
            ) : (
              <p className="muted">
                Add a game to see its installation details.
              </p>
            )}
          </div>
        </div>
        <div className="help-step">
          <span>↗</span>
          <div>
            <h3>Configure player capture</h3>
            <p>Player capture is off by default. Review a unique origin-clean canvas and add privacy masks before enabling it. Ask for recording consent separately from analytics consent; call <code>await Blaze.startCapture(&#123;consent:true&#125;)</code> only after both are granted. Stop with <code>await Blaze.stopCapture()</code>, or discard with <code>await Blaze.stopCapture(&#123;discard:true&#125;)</code>. Analytics withdrawal also discards capture.</p>
            <p>Capture is sampled and limited to up to four 30-second segments at 5 fps, 960 × 540, and 3 MiB each. Gaps and upload failures may leave parts unrecorded. It contains the canvas only, no audio or DOM. Inspect private footage in Sessions.</p>
          </div>
        </div>
        <div className="help-step">
          <span>06</span>
          <div>
            <h3>Interpret the evidence</h3>
            <p>
              Analytics default to human activity. Small samples, missing
              attribution and immature return cohorts limit conclusions. Pointer
              density is interaction evidence, not a replay. Treat hypotheses as
              questions to validate.
            </p>
          </div>
        </div>
      </div>
      <aside className="help-aside">
        <div className="section-kicker">SYSTEM STATUS</div>
        <h3>Setup dependencies</h3>
        <div className="health-row">
          <span>Database</span>
          <Status value={system.database ? "connected" : "disconnected"} />
        </div>
        <div className="health-row">
          <span>Storage guard</span>
          <strong>{!usage ? "Not configured" : usage.paused ? "Paused" : "Active"}</strong>
        </div>
        {usage && <div className="database-usage muted">
          <p>Current database: {size(usage.bytes)} / {size(usage.limitBytes)}{usage.bytes !== null && usage.limitBytes ? ` (${(usage.bytes / usage.limitBytes * 100).toFixed(1)}%)` : ""}.</p>
          <p>Measured: {usage.measuredAt ? dateTime(usage.measuredAt) : "Unavailable"}. Event ingestion pauses at 80% of the configured limit.</p>
          {usage.reason && <p>{usage.reason}</p>}
          <p>This is an estimate of the current database, not total Neon project storage.</p>
        </div>}
        <p className="muted">Raw event retention: Not configured.</p>
        <div className="health-row">
          <span>Google sign-in</span>
          <Status value={system.google ? "configured" : "disconnected"} />
        </div>
        <div className="health-row">
          <span>Asset storage</span>
          <Status value={system.storage ? "configured" : "disconnected"} />
        </div>
      </aside>
    </div>
  );
}
