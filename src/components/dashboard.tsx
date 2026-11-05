"use client";
import GeneratedContentBank from "./generated-content-bank";
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
  Clapperboard,
  Clock3,
  ExternalLink,
  FileText,
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
  Video,
  X,
} from "lucide-react";
import dynamic from "next/dynamic";
import ManualExportPanel from "./manual-export-panel";
import GameConnections from "./game-connections";
import InfoHint from "./info-hint";
import MostPlayedGames from "./most-played-games";
import {dashboardHref,readDashboardLocation,type DashboardView} from "@/lib/dashboard-location";
const ActionsPage = dynamic(() => import("./actions-page"), { loading: () => <p role="status">Loading actions…</p> });
const ContentStudio = dynamic(() => import("./content-studio"), { loading: () => <p role="status">Loading video studio…</p> });
const GameArchiveControls = dynamic(() => import("./game-archive-controls"));
const AccountSettings = dynamic(() => import("./account-settings"), { loading: () => <p role="status">Loading account settings…</p> });
const DiscoveryReview = dynamic(() => import("./discovery-review").then(module => module.DiscoveryReview), { loading: () => <p role="status">Loading search review…</p> });
import type {
  Analytics,
  Channel,
  Clip,
  Finding,
  Measurement,
  MeasurementMetrics,
  Game,
  Post,
  Recording,
  SessionSummary,
  SessionCapture,
  TelemetryEvent,
  WorkspaceSnapshot,
} from "@/lib/types";

const PlayerAnalytics = dynamic(() => import("./player-analytics"), { loading: () => <div className="analytics-loading" role="status">Loading analytics…</div> });
const ForeverHealth = dynamic(() => import("./forever-health"), { loading: () => <p role="status">Loading Forever diagnostics…</p> });

type GameImportMetadata = { url: string; title: string; description: string; image: string; genre: string; metadataStatus: string; manifestSource: { url: string; observedAt: string; sha256: string; formatVersion: 1 } };
type GameImportState = { status: "idle" | "waiting" | "loading" | "ready" | "error"; input: string; metadata?: GameImportMetadata; error?: string };

type Page = DashboardView;
type Modal =
  | "game"
  | "recording"
  | "clip"
  | "post"
  | "connection"
  | "review"
  | "measurement"
  | null;
type InvestigationEvidence = { eventId: string; name: string; timestamp: string; replay?: { captureId: string; offsetSeconds: number; segment?: number } };
type InvestigationMatch = { session: SessionSummary; evidence: InvestigationEvidence };
type InvestigationState = { kind: "heatmap" | "dropoff"; title: string; loading: boolean; error?: string; results: InvestigationMatch[]; hasMore: boolean; windowStart?: string; windowEnd?: string };
const nav: { id: Page; label: string; icon: typeof Activity }[] = [
  { id: "overview", label: "Dashboard", icon: LayoutDashboard },
  { id: "games", label: "Games", icon: Gamepad2 },
  { id: "analytics", label: "Player analytics", icon: BarChart3 },
  { id: "forever", label: "Forever health", icon: Activity },
  { id: "sessions", label: "Sessions", icon: Users },
  { id: "discovery", label: "SEO & AEO", icon: Search },
  { id: "recordings", label: "Recordings & clips", icon: Clapperboard },
  { id: "content", label: "Content studio", icon: FileText },
  { id: "calendar", label: "Calendar", icon: CalendarDays },
  { id: "research", label: "Actions", icon: Search },
];
const socialProviders = ["x", "youtube", "instagram", "tiktok"];
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
const dateTimeInZone = (value: string, timeZone?: string) => {
  try { return new Date(value).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", ...(timeZone ? { timeZone } : {}) }); }
  catch { return dateTime(value); }
};
const validTimeZone = (zone?: string) => {
  if (!zone) return false;
  try { new Intl.DateTimeFormat("en", { timeZone: zone }); return true; } catch { return false; }
};
const validPlannedTime = (time?: string, zone?: string) => !!time && Number.isFinite(Date.parse(time)) && validTimeZone(zone);
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
const trackingUrl = (post: Post) =>
  (post as Post & { trackingUrl?: string }).trackingUrl;
const gameName = (games: Game[], id: string) =>
  games.find((g) => g.id === id)?.title || "Unknown game";
const dateInput = (v?: string) =>
  v
    ? new Date(new Date(v).getTime() - new Date(v).getTimezoneOffset() * 60000)
        .toISOString()
        .slice(0, 16)
    : "";

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
  const [seekAt, setSeekAt] = useState<number | undefined>(undefined);
  const [chosenRecording, setChosenRecording] = useState<Recording | null>(
      null,
    ),
    [chosenClip, setChosenClip] = useState<Clip | null>(null),
    [chosenPost, setChosenPost] = useState<Post | null>(null),
    [chosenSession, setChosenSession] = useState<SessionSummary | null>(null),
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
  const [advancedSocial, setAdvancedSocial] = useState(false);
  const [adapterState, setAdapterState] = useState<{ gameId: string; verified: boolean } | null>(null);
  const [creator, setCreator] = useState<{
    privacyOptions: string[];
    commentDisabled: boolean;
    duetDisabled: boolean;
    stitchDisabled: boolean;
    maxDuration: number;
    username: string;
  } | null>(null);
  const [calendarMode, setCalendarMode] = useState<"week" | "month" | "list">(
      "week",
    ),
    [calendarOffset, setCalendarOffset] = useState(0);
  const [draft, setDraft] = useState({
    url: "",
    title: "",
    image: "",
    genre: "",
    gameId: "",
    mode: "fixture",
    recordingId: "",
    start: "0",
    end: "10",
    layout: "portrait",
    clipId: "",
    channel: "x",
    deliveryMethod: "native",
    text: "",
    accountId: "",
    scheduledAt: "",
    provider: "x",
    token: "",
    refreshToken: "",
    model: "",
    workspaceId: "",
    label: "",
    dailyEnabled: true,
    competitors: "",
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
    tiktokPrivacy: "",
    disableComment: false,
    disableDuet: false,
    disableStitch: false,
    tiktokConsent: false,
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
          if (!response.ok) throw new Error(data.error || "The game manifest could not be imported.");
          if (!data.metadata?.manifestSource || typeof data.metadata.title !== "string") throw new Error("The import response is incomplete. Try again.");
          if (!controller.signal.aborted) setGameImport({ status: "ready", input, metadata: data.metadata });
        })
        .catch(error => { if (!controller.signal.aborted) setGameImport({ status: "error", input, error: error instanceof Error ? error.message : "The game manifest could not be imported." }); });
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
    const socialResult = params.get("social");
    const provider = params.get("provider") || "";
    if (socialProviders.includes(provider) && socialResult) {
      const name = provider === "x" ? "X" : label(provider);
      const messages: Record<string, string> = {
        connected: `${name} account connected.`,
        failed: `${name} authorization failed. Try connecting again.`,
        denied: `${name} authorization was denied.`,
        account_mismatch: `${name} returned a different account. Reconnect the original account.`,
      };
      if (messages[socialResult]) setNotice(messages[socialResult]);
      window.history.replaceState(null, "", window.location.pathname);
    }
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
  const activeJobs =
    !!snapshot &&
    !snapshot.demo &&
    (snapshot.recordings.some((r) =>
      ["queued", "recording"].includes(r.status),
    ) ||
      snapshot.clips.some((c) => c.status === "queued") ||
      snapshot.posts.some((p) =>
        ["uploading", "processing"].includes(p.status),
      ));
  useEffect(() => {
    if (!snapshot || snapshot.demo) return;
    const tick = () => {
      if (document.visibilityState === "visible")
        void refresh(selectedGame, false);
    };
    const timer = window.setInterval(tick, activeJobs ? 5000 : 30000);
    document.addEventListener("visibilitychange", tick);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [snapshot?.demo, selectedGame, period, activeJobs, refresh]);
  useEffect(() => {
    if (!snapshot) return;
    setChosenRecording((current) =>
      current
        ? snapshot.recordings.find((r) => r.id === current.id) || current
        : null,
    );
    setChosenClip((current) =>
      current
        ? snapshot.clips.find((c) => c.id === current.id) || current
        : null,
    );
    setChosenPost((current) => {
      if (!current) return null;
      const fresh = snapshot.posts.find((p) => p.id === current.id);
      return fresh
        ? fresh
        : current;
    });
  }, [snapshot]);
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
  const socialAction = async (provider: string, operation: "connect" | "refresh" | "disconnect", connectionId?: string) => {
    if (snapshot?.demo) { setNotice("Example workspace is read-only. Sign in to connect an account."); return; }
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/social/${provider}/${operation}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(connectionId ? { connectionId } : {}),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || `Could not ${operation} account`);
      if (operation === "connect") {
        if (typeof data.url !== "string") throw new Error("Authorization URL is unavailable.");
        window.location.assign(data.url);
        return;
      }
      await refresh();
      setNotice(data.warning || (operation === "refresh" ? "Account refreshed." : "Account disconnected."));
    } catch (e) { setError(e instanceof Error ? e.message : `Could not ${operation} account`); }
    finally { setBusy(false); }
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
    setCreator(null);
    setAdvancedSocial(false);
    setDraft({
      url: "",
      title: "",
      image: "",
      genre: "",
      gameId: selectedGame === "all" ? "" : selectedGame,
      mode: "fixture",
      recordingId: "",
      start: "0",
      end: "10",
      layout: "portrait",
      clipId: "",
      channel: "x",
      deliveryMethod: "native",
      text: "",
      accountId: "",
      scheduledAt: "",
      provider: "x",
      token: "",
      refreshToken: "",
      model: "",
      workspaceId: "",
      label: "",
      dailyEnabled: true,
      competitors: "",
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
      tiktokPrivacy: "",
      disableComment: false,
      disableDuet: false,
      disableStitch: false,
      tiktokConsent: false,
      note: "",
      releaseVersion: "", releaseDescription: "", releaseEvidenceUrl: "", releaseEffectiveAt: "",
      baselineStart: "", baselineEnd: "", followupStart: "", followupEnd: "",
    });
  };
  const openModal = (m: Modal) => {
    setError("");
    resetDraft();
    setChosenGame(null);
    setChosenPost(null);
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
      dailyEnabled: g.dailyEnabled,
      competitors: g.competitors.join("\n"),
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
  const filteredGames =
    selectedGame === "all" ? (page === "games" ? games.filter(g=>g.foreverCatalogue?.state!=="retired") : games) : games.filter((g) => g.id === selectedGame);
  const featuredGame = filteredGames[0];
  const records = (snapshot?.recordings || []).filter(
      (x) => selectedGame === "all" || x.gameId === selectedGame,
    ),
    clips = (snapshot?.clips || []).filter(
      (x) => selectedGame === "all" || x.gameId === selectedGame,
    ),
    posts = (snapshot?.posts || []).filter(
      (x) => selectedGame === "all" || x.gameId === selectedGame,
    ),
    findings = (snapshot?.findings || []).filter(
      (x) => selectedGame === "all" || x.gameId === selectedGame,
    ),
    runs = (snapshot?.runs || []).filter(
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
  const latestRecording = [...records].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  const latestRun = [...runs].sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0];
  const currentRecording = records.find((r) => ["queued", "recording"].includes(r.status));
  const currentRun = runs.find((r) => r.status === "running");
  const lastRecordingError = [...records].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).find((r) => r.error);
  const lastRunError = [...runs].sort((a, b) => b.startedAt.localeCompare(a.startedAt)).find((r) => r.error);
  const jev = snapshot?.demo ? undefined : [...(snapshot?.connections || [])].filter((c) => c.provider === "jev").sort((a, b) => (b.checkedAt || "").localeCompare(a.checkedAt || ""))[0];
  const jevValidation = adapterState?.gameId === selectedGame && adapterState.verified;
  useEffect(() => {
    setAdapterState(null);
    if (!snapshot || snapshot.demo || selectedGame === "all") return;
    let cancelled = false;
    const check = async () => {
      try {
        const response = await fetch(`/api/games/${encodeURIComponent(selectedGame)}/automation`, { cache: "no-store" });
        const data = await response.json();
        if (!cancelled) setAdapterState({ gameId: selectedGame, verified: response.ok && data.adapterVerified === true });
      } catch { if (!cancelled) setAdapterState(null); }
    };
    void check();
    const timer = setInterval(check, 30000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [selectedGame, snapshot?.demo]);
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
  const editPost = (p: Post) => {
    const t = (
      p as Post & {
        tiktokConsent?: {
          consent: boolean;
          privacy: string;
          disableComment: boolean;
          disableDuet: boolean;
          disableStitch: boolean;
        };
      }
    ).tiktokConsent;
    setCreator(null);
    setChosenPost(p);
    setDraft((d) => ({
      ...d,
      gameId: p.gameId,
      clipId: p.clipId || "",
      channel: p.channel,
      deliveryMethod: p.deliveryMethod || "native",
      text: p.text,
      accountId: p.accountId,
      scheduledAt: dateInput(p.scheduledAt),
      tiktokPrivacy: "",
      disableComment: t?.disableComment || false,
      disableDuet: t?.disableDuet || false,
      disableStitch: t?.disableStitch || false,
      tiktokConsent: false,
    }));
    setModal("post");
  };
  const reviewPost = (p: Post) => {
    setChosenPost(p);
    setModal("review");
  };
  const copyTrackedLink = async (p: Post) => {
    const url = trackingUrl(p);
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setNotice("Tracked link copied.");
    } catch {
      setError("Could not copy the tracked link. Select and copy it manually.");
    }
  };
  const openRecordingEvidence = (id: string, at?: number) => {
    const r = snapshot?.recordings.find((x) => x.id === id);
    if (!r) {
      setNotice("This recording is unavailable in the workspace.");
      return;
    }
    setSelectedGame(r.gameId);
    setChosenRecording(r);
    setChosenClip(null);
    setSeekAt(at);
    changePage("recordings");
  };
  const openClip = (r: Recording) => {
    resetDraft();
    setChosenRecording(r);
    setDraft((d) => ({
      ...d,
      recordingId: r.id,
      gameId: r.gameId,
      end: String(Math.min(r.duration || 10, 10)),
    }));
    setModal("clip");
  };
  const formSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (modal === "game") {
      if (!chosenGame && (gameImport.status !== "ready" || gameImport.input !== draft.url.trim())) {
        setError("Fetch and validate the game manifest before adding the game.");
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
              dailyEnabled: draft.dailyEnabled,
              competitors: draft.competitors
                .split("\n")
                .map((x) => x.trim())
                .filter(Boolean),
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
    } else if (modal === "recording")
      await action({
        action: "queue_recording",
        gameId: draft.gameId,
        mode: draft.mode,
      });
    else if (modal === "clip")
      await action({
        action: "create_clip",
        recordingId: draft.recordingId,
        title: draft.title,
        start: Number(draft.start),
        end: Number(draft.end),
        layout: draft.layout,
      });
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
        advanced: socialProviders.includes(draft.provider) ? true : undefined,
        provider: draft.provider,
        label: draft.label,
        token: draft.token,
        accountId: draft.accountId || undefined,
        model: draft.model || undefined,
        workspaceId:
          draft.provider === "anthropic"
            ? draft.workspaceId || undefined
            : undefined,
        refreshToken: draft.refreshToken || undefined,
      });
    else if (modal === "post") {
      const data = {
        gameId: draft.gameId,
        clipId: draft.clipId || undefined,
        channel: draft.channel,
        deliveryMethod: draft.deliveryMethod,
        timeZone: localTimeZone || "UTC",
        text: draft.text,
        accountId: draft.accountId,
        scheduledAt: draft.scheduledAt
          ? new Date(draft.scheduledAt).toISOString()
          : null,
        ...(draft.deliveryMethod === "native" && draft.channel === "tiktok" && draft.tiktokPrivacy
          ? {
              tiktokConsent: {
                consent: draft.tiktokConsent,
                privacy: draft.tiktokPrivacy,
                disableComment: draft.disableComment,
                disableDuet: draft.disableDuet,
                disableStitch: draft.disableStitch,
              },
            }
          : {}),
      };
      await action(
        chosenPost
          ? { action: "update_post", id: chosenPost.id, ...data }
          : { action: "create_post", ...data },
      );
    }
  };
  const loadCreator = async () => {
    if (snapshot?.demo) {
      setNotice(
        "Example workspace is read-only. Sign in to configure a TikTok account.",
      );
      return;
    }
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/actions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "get_tiktok_creator",
          accountId: draft.accountId,
        }),
      });
      const data = await r.json();
      if (!r.ok)
        throw new Error(data.error || "Could not load creator settings");
      setCreator(data);
      setDraft((d) => ({
        ...d,
        tiktokPrivacy: "",
        tiktokConsent: false,
        disableComment: !!data.commentDisabled,
        disableDuet: !!data.duetDisabled,
        disableStitch: !!data.stitchDisabled,
      }));
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Could not load creator settings",
      );
    } finally {
      setBusy(false);
    }
  };
  const generate = async () => {
    const result = await action(
      {
        action: "generate_draft",
        gameId: draft.gameId,
        clipId: draft.clipId || undefined,
        channel: draft.channel,
      },
      false,
    );
    if (result) {
      const text = result.text || result.draft?.text || result.draft;
      if (typeof text === "string") setDraft((d) => ({ ...d, text }));
      else
        setNotice(
          "Draft generated. Refresh or check the response in the content studio.",
        );
    }
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
            Bring your games, player evidence and content workflow into one
            place.
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
            { title: "Player evidence", items: nav.slice(0, 5) },
            { title: "Production", items: nav.slice(5) },
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
                  {n.id === "content" && posts.filter((p) => p.status === "review").length > 0 && (
                    <i>{posts.filter((p) => p.status === "review").length}</i>
                  )}
                </button>
              ))}
            </div>
          ))}
        </nav>
        <div className="sidebar-bottom">
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
            {!["account", "content", "recordings"].includes(page) && <Button variant="primary" onClick={() => openModal("game")}>
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
          {page !== "account" && <div className="page-heading">
            <div>
              <div className="page-title-line"><h1>{title}</h1><InfoHint label={`About ${title}`}>{pageDescriptions[page]}</InfoHint></div>
            </div>
            {page !== "connections" && page !== "help" && page !== "research" && page !== "forever" && (
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
                {["overview","analytics","sessions"].includes(page) && <label>
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
              </div>
            )}
          </div>}
          {page === "forever" && <ForeverHealth demo={snapshot.demo}/>}
          {page === "overview" && sessionScopeReady && <MostPlayedGames analytics={snapshot.analytics} games={games} />}
          {(page === "overview" || page === "analytics") && (sessionScopeReady ? <PlayerAnalytics
            analytics={analytics} games={games} gameId={selectedGame} days={period} demo={snapshot.demo} detailed
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
                detail="Add a public web game URL to begin setup."
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
                        {g.manifestSource && <a className="game-manifest-source" href={g.manifestSource.url} target="_blank" rel="noreferrer">Imported from forever.json <ExternalLink size={11}/></a>}
                        <span className="tag">
                          {g.genre || "Web game"}
                        </span>{" "}
                        <span className="muted">
                          Added {shortDate(g.createdAt)}
                        </span>
                      </div>
                      <div className="game-actions">
                        <Button onClick={() => { setSelectedGame(g.id); changePage("content"); }}>Scripts &amp; video studio</Button>
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
                  detail="Add a game to start collecting player activity and creating recordings."
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
            <SectionHead title={games.find(game => game.id === selectedGame)?.title || "Choose a game"} detail="Public SEO/AEO checks and suggested fixes. Gameplay investigation and AI keys are not required." action={<Button onClick={() => changePage("games")}>Back to games</Button>}/>
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
          {page === "recordings" && <GeneratedContentBank
            gameId={selectedGame} games={games} demo={snapshot.demo} recordings={records} clips={clips}
            selectedRecording={chosenRecording} seekAt={seekAt}
            onRecordingSelect={setChosenRecording}
            onQueueRecording={() => openModal("recording")}
            onStudio={() => changePage("content")}
            onCreateClip={(recording, start) => { openClip(recording); if(start !== undefined) setDraft(d => ({...d, start:String(start), end:String(Math.min(recording.duration || start+10,start+10))})); }}
            onCreatePost={clip => { resetDraft(); setDraft(d => ({...d,gameId:clip.gameId,clipId:clip.id})); setModal("post"); }}
          />}
          {page === "content" && (
            <>
              <ContentStudio key={selectedGame} games={games} gameId={selectedGame} demo={snapshot.demo}/>
              {posts.length>0&&<details className="post-drafts-disclosure"><summary>Post drafts · {posts.length}</summary>
              <SectionHead
                title="Post drafts"
                detail="Prepare text for the videos you will post manually."
                action={posts.length>0?
                  <Button variant="primary" onClick={() => openModal("post")}>
                    <Plus size={16} /> New post
                  </Button>:undefined
                }
              />
              {posts.length ? (
                <div className="post-list">
                  {posts.map((p) => (
                    <PostRow
                      key={p.id}
                      post={p}
                      games={games}
                      onEdit={() => editPost(p)}
                      onReview={() => reviewPost(p)}
                    />
                  ))}
                </div>
              ) : (
                <Empty
                  title="No posts yet"
                  detail="Turn a clip or game into a channel draft, then send it for review."
                  action={
                    <Button onClick={() => openModal("post")}>
                      Create a post
                    </Button>
                  }
                />
              )}
              </details>}
            </>
          )}
          {page === "calendar" && (
            <>
              <ContentStudio key={selectedGame} games={games} gameId={selectedGame} demo={snapshot.demo} calendarOnly/>
              <div className="calendar-toolbar">
                <div>
                  <h2>Post calendar</h2>
                  <p>Planning only · download and post manually.</p>
                </div>
                <div className="calendar-controls">
                  <div className="segmented">
                    {(["week", "month", "list"] as const).map((m) => (
                      <button
                        key={m}
                        className={calendarMode === m ? "selected" : ""}
                        onClick={() => setCalendarMode(m)}
                      >
                        {label(m)}
                      </button>
                    ))}
                  </div>
                  <button
                    className="icon-button bordered"
                    aria-label="Previous period"
                    onClick={() => setCalendarOffset((x) => x - 1)}
                  >
                    <ChevronLeft size={16} />
                  </button>
                  <button
                    className="icon-button bordered"
                    aria-label="Next period"
                    onClick={() => setCalendarOffset((x) => x + 1)}
                  >
                    <ChevronRight size={16} />
                  </button>
                  <Button onClick={() => setCalendarOffset(0)}>Today</Button>
                </div>
              </div>
              <Calendar
                posts={posts}
                games={games}
                mode={calendarMode}
                offset={calendarOffset}
                onSelect={editPost}
              />
            </>
          )}
          {page === "research" && <><ActionsPage key={selectedGame} games={games} findings={findings} recordings={snapshot.recordings} measurements={snapshot.measurements || []} runs={runs} selectedGame={selectedGame} demo={snapshot.demo} onAction={action} onUpdated={refresh} onMeasure={startMeasurement} onRecording={openRecordingEvidence} onAccount={() => changePage("account")} onGameChange={(id) => setSelectedGame(id || "all")} /><details className="actions-history"><summary>Recorded game changes and comparisons · {(snapshot.measurements || []).length}</summary><Measurements items={(snapshot.measurements || []).filter(m => selectedGame === "all" || m.gameId === selectedGame)} findings={findings}/></details></>}
          {page === "account" && (snapshot.demo ? <Empty title="Sign in to configure your account" detail="The example workspace does not store credentials."/> : <AccountSettings user={snapshot.user} onSaved={async () => { await refresh(); }}/>) }
          {page === "connections" && (
            <>
              <GameConnections games={games} origin={origin} onSynced={async()=>{await refresh();}} onAdd={() => openModal("game")} onSetup={(gameId) => { setSelectedGame(gameId); changePage("help"); }} onSessions={(gameId) => { setSelectedGame(gameId); changePage("sessions"); }}/>
              <SectionHead
                title="Social & research integrations"
                detail="Connect publishing accounts and research sources. Jev and AI provider keys are in Account settings."
                action={
                  <Button
                    variant="primary"
                    onClick={() => openModal("connection")}
                  >
                    <Plus size={16} /> Add connection
                  </Button>
                }
              />
              <div className="connection-list">
                {[
                  "x",
                  "youtube",
                  "instagram",
                  "tiktok",
                  "reddit",
                  "brave",
                  "search_console",
                ].map((provider) => {
                  const con = snapshot.connections.filter(
                    (c) => c.provider === provider,
                  );
                  return (
                    <div className="connection-row" key={provider}>
                      <div className="provider-icon">
                        {provider.slice(0, 1).toUpperCase()}
                      </div>
                      <div className="provider-copy">
                        <strong>
                          {provider === "x" ? "X" : label(provider)}
                        </strong>
                        <span>{providerDescriptions[provider]}</span>
                        {socialProviders.includes(provider) && !snapshot.system.social?.find((item) => item.provider === provider)?.configured && (
                          <small>OAuth app setup required. Connect to see setup instructions.</small>
                        )}
                        {con.map((c) => (
                          <div className="connection-account" key={c.id}>
                            <small>{c.accountName || c.label}{c.accountId ? ` · ID: ${c.accountId}` : ""} · {c.authMethod === "oauth" ? "OAuth" : "Manual"}{c.requiresReconnect ? " · Reconnect required" : ""}{c.checkedAt ? ` · Checked ${dateTime(c.checkedAt)}` : " · Not checked"}{c.expiresAt ? ` · Expires ${dateTime(c.expiresAt)}` : ""}{c.scopes?.length ? ` · Scopes: ${c.scopes.join(", ")}` : ""}</small>
                            {socialProviders.includes(provider) ? <div className="account-actions">
                              <button onClick={() => void socialAction(provider, "connect", c.id)} disabled={busy}>Reconnect</button>
                              {c.authMethod === "oauth" && <button onClick={() => void socialAction(provider, "refresh", c.id)} disabled={busy}>Refresh</button>}
                              <button onClick={() => void socialAction(provider, "disconnect", c.id)} disabled={busy}>Disconnect</button>
                            </div> : <button className="account-remove" onClick={() => action({ action: "delete_connection", id: c.id })}>Remove</button>}
                          </div>
                        ))}
                      </div>
                      <Status
                        value={
                          con.some((c) => c.connected)
                            ? "connected"
                            : "disconnected"
                        }
                      />
                      <Button
                        onClick={() => {
                          if (socialProviders.includes(provider)) { void socialAction(provider, "connect"); return; }
                          resetDraft();
                          setDraft((d) => ({ ...d, provider }));
                          setModal("connection");
                        }}
                      >
                        {con.length ? "Add account" : "Connect"}
                      </Button>
                    </div>
                  );
                })}
              </div>
              <div className="data-note">
                A saved credential does not guarantee a provider is ready.
                Verify scopes, native account authorization and any platform
                review. TikTok public posting may require app audit. Worker:{" "}
                {snapshot.system.worker ? "connected" : "not connected"};
                storage:{" "}
                {snapshot.system.storage ? "configured" : "not configured"}.
              </div>
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
          {modal === "review" && chosenPost ? (
            <>
              <div className="review-content">
                <div className="review-meta">
                  <span>{label(chosenPost.channel)}</span>
                  <span>{gameName(games, chosenPost.gameId)}</span>
                  <Status value={chosenPost.status} />
                </div>
                <div className="review-text">{chosenPost.text}</div>
                <dl>
                  <dt>Delivery</dt>
                  <dd>{chosenPost.deliveryMethod === "manual" ? "Manual export" : "Connected account"}</dd>
                  <dt>Destination account</dt>
                  <dd>{chosenPost.deliveryMethod === "manual" ? `${chosenPost.accountId || "Not entered"} · Unverified, entered by you` : (() => {
                    const account = snapshot.connections.find((c) => c.provider === chosenPost.channel && c.accountId === chosenPost.accountId && c.connected && !c.requiresReconnect);
                    return account?.accountName ? `${account.accountName} · ID: ${chosenPost.accountId}` : `Name not verified · ID: ${chosenPost.accountId || "Not selected"}`;
                  })()}</dd>
                  <dt>Clip</dt>
                  <dd>
                    {clips.find((c) => c.id === chosenPost.clipId)?.title ||
                      "None"}
                  </dd>
                  <dt>Planned time</dt>
                  <dd>{chosenPost.scheduledAt ? dateTimeInZone(chosenPost.scheduledAt, chosenPost.timeZone) : "Not scheduled"}{chosenPost.timeZone ? ` · ${chosenPost.timeZone}` : ""}</dd>
                  {chosenPost.deliveryMethod !== "manual" && chosenPost.channel === "tiktok" && (
                    <>
                      <dt>TikTok settings</dt>
                      <dd>
                        {chosenPost.tiktokConsent
                          ? `${chosenPost.tiktokConsent.privacy} · comments ${chosenPost.tiktokConsent.disableComment ? "off" : "on"} · duet ${chosenPost.tiktokConsent.disableDuet ? "off" : "on"} · stitch ${chosenPost.tiktokConsent.disableStitch ? "off" : "on"} · consent ${chosenPost.tiktokConsent.consent ? "given" : "missing"}`
                          : "Not configured"}
                      </dd>
                    </>
                  )}
                </dl>
                {chosenPost.recommendation && <PostRecommendation post={chosenPost} />}
                {chosenPost.deliveryMethod === "manual" && !validPlannedTime(chosenPost.scheduledAt, chosenPost.timeZone) && <p className="error-text">Set a planned time and time zone in Edit post before approval.</p>}
                {trackingUrl(chosenPost) && (
                  <div className="tracked-link">
                    <strong>Tracked game link</strong>
                    <a
                      href={trackingUrl(chosenPost)}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {trackingUrl(chosenPost)}
                    </a>
                    <Button onClick={() => copyTrackedLink(chosenPost)}>
                      Copy tracked link
                    </Button>
                    {!chosenPost.text.includes(trackingUrl(chosenPost)!) && (
                      <p className="tracking-warning">
                        This link is not in the post text. Attribution to this
                        post will be incomplete unless players use the tracked
                        link.
                      </p>
                    )}
                  </div>
                )}
                {chosenPost.error && (
                  <div className="alert error">{chosenPost.error}</div>
                )}
                <p className="muted">
                  Approval applies to this exact content, account, media and
                  planned time. Editing invalidates approval.
                </p>
                {chosenPost.deliveryMethod === "manual" && validPlannedTime(chosenPost.scheduledAt, chosenPost.timeZone) && <ManualExportPanel key={chosenPost.id} post={chosenPost} onChanged={() => refresh()} />}
              </div>
              <div className="modal-actions">
                <Button onClick={() => editPost(chosenPost)}>Edit post</Button>
                {chosenPost.status === "draft" && (
                  <Button
                    onClick={() =>
                      action({ action: "submit_review", id: chosenPost.id })
                    }
                  >
                    Request review
                  </Button>
                )}
                {chosenPost.status === "review" && (
                  <Button
                    variant="primary"
                    disabled={
                      (chosenPost.deliveryMethod === "manual" && !validPlannedTime(chosenPost.scheduledAt, chosenPost.timeZone)) ||
                      (chosenPost.deliveryMethod !== "manual" && (!snapshot.connections.some((c) => c.provider === chosenPost.channel && c.accountId === chosenPost.accountId && c.connected && !c.requiresReconnect && !!c.accountName) ||
                      (chosenPost.channel === "tiktok" &&
                      (!chosenPost.tiktokConsent?.consent ||
                        !chosenPost.tiktokConsent?.privacy))))
                    }
                    onClick={() =>
                      action({ action: "approve_post", id: chosenPost.id })
                    }
                  >
                    Approve post
                  </Button>
                )}
                {chosenPost.deliveryMethod !== "manual" && ["approved", "scheduled"].includes(chosenPost.status) && (
                  <Button
                    variant="primary"
                    onClick={() =>
                      action({ action: "publish_post", id: chosenPost.id })
                    }
                  >
                    Publish now
                  </Button>
                )}
                <Button
                  variant="danger"
                  onClick={() => {
                    if (window.confirm("Delete this post?"))
                      void action({ action: "delete_post", id: chosenPost.id });
                  }}
                >
                  Delete
                </Button>
              </div>
            </>
          ) : (
            <form onSubmit={formSubmit}>
              {error && <div ref={formError} className="alert error" role="alert">{error}</div>}
              {modal === "game" && (
                <>
                  {chosenGame ? <><p>Main source URL: {chosenGame.url}</p><GameSourceEditor game={chosenGame} onSaved={() => { setModal(null); void refresh(); }}/></> : <Field label="Game page URL" hint="Blaze reads this game page’s /forever.json file and imports its metadata.">
                    <input required type="url" placeholder="https://yourgame.com/my/game" value={draft.url} onChange={e => { setError(""); setDraft({ ...draft, url: e.target.value }); }} />
                  </Field>}
                  {!chosenGame && <div className="manifest-import">
                    {manifestAddress(draft.url) && <div className="manifest-address"><span>Manifest URL</span><code>{manifestAddress(draft.url)}</code></div>}
                    {(gameImport.status === "waiting" || gameImport.status === "loading") && <p className="manifest-status" role="status"><LoaderCircle className="spin" size={15} /> Fetching and validating the manifest…</p>}
                    {gameImport.status === "error" && <div className="manifest-import-error" role="alert"><strong>Game could not be imported</strong><p>{gameImport.error}</p><button type="button" className="text-action" onClick={() => setImportRetry(value => value + 1)}>Try again <ArrowRight size={13}/></button></div>}
                    {gameImport.status === "ready" && gameImport.metadata && <div className="manifest-preview" role="status">
                      <div className="manifest-preview-head">{gameImport.metadata.image && <img src={gameImport.metadata.image} alt=""/>}<div><span><Check size={13}/> Manifest validated</span><h3>{gameImport.metadata.title}</h3><p>{gameImport.metadata.genre}</p></div></div>
                      <p className="manifest-description">{gameImport.metadata.description}</p>
                      <div className="manifest-provenance"><a href={gameImport.metadata.manifestSource.url} target="_blank" rel="noreferrer">View source manifest <ExternalLink size={12}/></a><span>Version {gameImport.metadata.manifestSource.formatVersion} · checked {dateTime(gameImport.metadata.manifestSource.observedAt)}</span></div>
                      <small>Name, description, genre and artwork come from this manifest. You can edit the game after adding it.</small>
                    </div>}
                    {gameImport.status === "idle" && <p className="quiet-help">The game must publish a valid Forever v1 manifest at the exact URL shown above.</p>}
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
                        <h3>Browser network permissions</h3>
                        <p className="muted">Same-origin HTTPS resources work by default. Only verified public destinations are allowed; unknown, private and local destinations are blocked, including redirects. WebSockets require an explicit origin, even on the game host.</p>
                        <Field label="Additional HTTPS resource origins" hint="Exact origins only, one per line; for example https://cdn.example.com. No paths or wildcards.">
                          <textarea rows={2} value={draft.resourceOrigins} onChange={(e) => setDraft({ ...draft, resourceOrigins: e.target.value })} />
                        </Field>
                        <Field label="Allowed WSS origins" hint="Exact origins only, one per line; for example wss://socket.example.com. Sockets are opt-in.">
                          <textarea rows={2} value={draft.webSocketOrigins} onChange={(e) => setDraft({ ...draft, webSocketOrigins: e.target.value })} />
                        </Field>
                        <Field label="Reviewed game frame URLs" hint="Up to two exact HTTPS game-frame URLs on this game’s origin, one per line. Include the full non-root path; no query, fragment, credentials, or wildcards. Review each frame before adding it.">
                          <textarea rows={2} value={draft.frameUrls} onChange={(e) => setDraft({ ...draft, frameUrls: e.target.value })} placeholder="https://game.example/play/index.html" />
                        </Field>
                      </div>
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
                      <Field
                        label="Competitor public URLs"
                        hint="One public URL per line. Research inspects public pages only."
                      >
                        <textarea
                          rows={3}
                          value={draft.competitors}
                          onChange={(e) =>
                            setDraft({ ...draft, competitors: e.target.value })
                          }
                        />
                      </Field>
                      <label className="checkbox">
                        <input
                          type="checkbox"
                          checked={draft.dailyEnabled}
                          onChange={(e) =>
                            setDraft({
                              ...draft,
                              dailyEnabled: e.target.checked,
                            })
                          }
                        />{" "}
                        Include this game in daily research
                      </label>
                    </>
                  )}
                </>
              )}
              {modal === "recording" && (
                <>
                  <Field label="Game">
                    <select
                      required
                      value={draft.gameId}
                      onChange={(e) =>
                        setDraft({ ...draft, gameId: e.target.value })
                      }
                    >
                      <option value="">Select a game</option>
                      {games.map((g) => (
                        <option key={g.id} value={g.id}>
                          {g.title}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Recording mode">
                    <select
                      value={draft.mode}
                      onChange={(e) =>
                        setDraft({ ...draft, mode: e.target.value })
                      }
                    >
                      <option value="fixture">Controlled fixture</option>
                      <option value="jev">Jev agent</option>
                    </select>
                  </Field>
                  <div className="data-note">
                    Fixture mode exercises the included controlled game; it does
                    not validate Jev. Jev requires a configured provider, a
                    compatible game adapter and a running worker.
                  </div>
                  {draft.mode === "jev" && <p className="error-text" role="alert">Paid Jev runs are blocked until an enforceable total spending cap and separate paid-run approval are configured.</p>}
                </>
              )}
              {modal === "clip" && (
                <>
                  <Field label="Clip title">
                    <input
                      required
                      value={draft.title}
                      onChange={(e) =>
                        setDraft({ ...draft, title: e.target.value })
                      }
                      placeholder="Name this highlight"
                    />
                  </Field>
                  <div className="form-grid">
                    <Field label="Start (seconds)">
                      <input
                        required
                        type="number"
                        min="0"
                        step="0.1"
                        value={draft.start}
                        onChange={(e) =>
                          setDraft({ ...draft, start: e.target.value })
                        }
                      />
                    </Field>
                    <Field label="End (seconds)">
                      <input
                        required
                        type="number"
                        min="0.1"
                        step="0.1"
                        value={draft.end}
                        onChange={(e) =>
                          setDraft({ ...draft, end: e.target.value })
                        }
                      />
                    </Field>
                  </div>
                  <Field label="Layout">
                    <select
                      value={draft.layout}
                      onChange={(e) =>
                        setDraft({ ...draft, layout: e.target.value })
                      }
                    >
                      <option value="portrait">Portrait · 9:16</option>
                      <option value="landscape">Landscape · 16:9</option>
                      <option value="square">Square · 1:1</option>
                    </select>
                  </Field>
                  <p className="muted">
                    Use the recording’s timestamped observations to choose a
                    highlight.
                  </p>
                </>
              )}
              {modal === "post" && (
                <>
                  <Field label="Game">
                    <select
                      required
                      value={draft.gameId}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          gameId: e.target.value,
                          clipId: "",
                        })
                      }
                    >
                      <option value="">Select a game</option>
                      {games.map((g) => (
                        <option key={g.id} value={g.id}>
                          {g.title}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <div className="form-grid">
                    <Field label="Channel">
                      <select
                        value={draft.channel}
                        onChange={(e) => {
                          setCreator(null);
                          setDraft({
                            ...draft,
                            channel: e.target.value,
                            accountId: "",
                            tiktokPrivacy: "",
                            tiktokConsent: false,
                          });
                        }}
                      >
                        {["x", "youtube", "instagram", "tiktok"].map((c) => (
                          <option key={c} value={c}>
                            {c === "x" ? "X" : label(c)}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label={draft.deliveryMethod === "manual" ? "Ready clip" : "Clip (optional)"}>
                      <select
                        required={draft.deliveryMethod === "manual"}
                        value={draft.clipId}
                        onChange={(e) =>
                          setDraft({ ...draft, clipId: e.target.value })
                        }
                      >
                        <option value="">{draft.deliveryMethod === "manual" ? "Select a ready clip" : "No clip"}</option>
                        {clips
                          .filter((c) => c.gameId === draft.gameId && (draft.deliveryMethod !== "manual" || c.status === "ready"))
                          .map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.title}
                            </option>
                          ))}
                      </select>
                    </Field>
                  </div>
                  <Field label="Delivery method">
                    <select value={draft.deliveryMethod} onChange={(e) => setDraft({ ...draft, deliveryMethod: e.target.value, accountId: "", tiktokConsent: false })}>
                      <option value="native">Connected account</option>
                      <option value="manual">Manual export</option>
                    </select>
                  </Field>
                  {draft.deliveryMethod === "manual" ? <Field label="Destination handle or account" hint="Entered by you and not verified with the platform."><input required value={draft.accountId} onChange={(e) => setDraft({ ...draft, accountId: e.target.value })} placeholder="e.g. @youraccount" /></Field> : <>
                  <Field
                    label="Account"
                    hint="Select a saved, authorized account for this channel."
                  >
                    <select
                      required
                      value={draft.accountId}
                      onChange={(e) => {
                        setCreator(null);
                        setDraft({
                          ...draft,
                          accountId: e.target.value,
                          tiktokPrivacy: "",
                          tiktokConsent: false,
                        });
                      }}
                    >
                      <option value="">Select an account</option>
                      {snapshot.connections
                        .filter(
                          (c) =>
                            c.provider === draft.channel &&
                            c.connected &&
                            c.accountId,
                        )
                        .map((c) => (
                          <option key={c.id} value={c.accountId}>
                            {c.accountName || `${c.label} (name not verified)`} · ID: {c.accountId}
                          </option>
                        ))}
                    </select>
                  </Field>
                  {!snapshot.connections.some(
                    (c) =>
                      c.provider === draft.channel &&
                      c.connected &&
                      c.accountId,
                  ) && (
                    <p className="muted">
                      No account available. Add an authorized account and
                      account ID in Connections.
                    </p>
                  )}
                  </>}
                  {draft.deliveryMethod === "native" && draft.channel === "tiktok" && (
                    <div className="tiktok-settings">
                      <strong>TikTok creator settings</strong>
                      <p className="muted">
                        Load current creator options for this account before
                        choosing visibility and permissions. TikTok may require
                        app review for public posting.
                      </p>
                      <Button
                        onClick={loadCreator}
                        disabled={!draft.accountId || busy}
                      >
                        Load creator options
                      </Button>
                      {creator && (
                        <>
                          <p className="muted">
                            {creator.username} · maximum duration{" "}
                            {creator.maxDuration}s
                          </p>
                          <Field label="Privacy">
                            <select
                              required
                              value={draft.tiktokPrivacy}
                              onChange={(e) =>
                                setDraft({
                                  ...draft,
                                  tiktokPrivacy: e.target.value,
                                  tiktokConsent: false,
                                })
                              }
                            >
                              <option value="">Select privacy</option>
                              {creator.privacyOptions.map((o) => (
                                <option key={o} value={o}>
                                  {label(o)}
                                </option>
                              ))}
                            </select>
                          </Field>
                          {(
                            [
                              [
                                "disableComment",
                                "Disable comments",
                                creator.commentDisabled,
                              ],
                              [
                                "disableDuet",
                                "Disable duet",
                                creator.duetDisabled,
                              ],
                              [
                                "disableStitch",
                                "Disable stitch",
                                creator.stitchDisabled,
                              ],
                            ] as const
                          ).map(([key, text, locked]) => (
                            <label className="checkbox" key={key}>
                              <input
                                type="checkbox"
                                checked={draft[key]}
                                disabled={locked}
                                onChange={(e) =>
                                  setDraft({
                                    ...draft,
                                    [key]: e.target.checked,
                                    tiktokConsent: false,
                                  })
                                }
                              />
                              {text}
                              {locked ? " (required by creator settings)" : ""}
                            </label>
                          ))}
                          <label className="checkbox">
                            <input
                              type="checkbox"
                              checked={draft.tiktokConsent}
                              onChange={(e) =>
                                setDraft({
                                  ...draft,
                                  tiktokConsent: e.target.checked,
                                })
                              }
                            />{" "}
                            I consent to publish this post with these TikTok
                            settings.
                          </label>
                        </>
                      )}
                    </div>
                  )}
                  {chosenPost &&
                    trackingUrl(chosenPost) &&
                    draft.gameId === chosenPost.gameId &&
                    draft.channel === chosenPost.channel && (
                      <div className="tracked-link">
                        <strong>Tracked game link</strong>
                        <a
                          href={trackingUrl(chosenPost)}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {trackingUrl(chosenPost)}
                        </a>
                        <Button onClick={() => copyTrackedLink(chosenPost)}>
                          Copy tracked link
                        </Button>
                        {!draft.text.includes(trackingUrl(chosenPost)!) && (
                          <p className="tracking-warning">
                            The link is not in this text. Attribution to this
                            post will be incomplete unless players use it.
                          </p>
                        )}
                      </div>
                    )}
                  {chosenPost &&
                    (draft.gameId !== chosenPost.gameId ||
                      draft.channel !== chosenPost.channel) && (
                      <div className="data-note">
                        Save changes to generate the tracked link for the
                        selected game and channel, then add it to the text and
                        request review again.
                      </div>
                    )}
                  <Field label="Post text">
                    <textarea
                      required
                      rows={5}
                      value={draft.text}
                      onChange={(e) =>
                        setDraft({ ...draft, text: e.target.value })
                      }
                      placeholder="Write the post…"
                    />
                  </Field>
                  <Button onClick={generate} disabled={!draft.gameId || busy}>
                    <Sparkles size={15} /> Generate draft
                  </Button>
                  <p className="muted">
                    Generation uses the provider and compatible model saved in Account settings.
                    Review all generated copy.
                  </p>
                  <Field label={draft.deliveryMethod === "manual" ? "Planned time" : "Planned time (optional)"} hint={draft.deliveryMethod === "manual" ? `Required for manual review. Uses your browser time zone (${localTimeZone || "unavailable"}); you can edit this time.` : `Uses your browser time zone (${localTimeZone || "local time"}).`}>
                    <input
                      type="datetime-local"
                      required={draft.deliveryMethod === "manual"}
                      value={draft.scheduledAt}
                      onChange={(e) =>
                        setDraft({ ...draft, scheduledAt: e.target.value })
                      }
                    />
                  </Field>
                  {chosenPost && (
                    <div className="data-note">
                      Saving changes invalidates any existing approval.
                    </div>
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
                  <Field label="Provider">
                    <select
                      value={draft.provider}
                      onChange={(e) =>
                        setDraft({ ...draft, provider: e.target.value })
                      }
                    >
                      {[
                        "x",
                        "youtube",
                        "instagram",
                        "tiktok",
                        "reddit",
                        "brave",
                        "search_console",
                      ].map((p) => (
                        <option key={p} value={p}>
                          {p === "x" ? "X" : label(p)}
                        </option>
                      ))}
                    </select>
                  </Field>
                  {socialProviders.includes(draft.provider) && !advancedSocial ? (
                    <div className="data-note">
                      <p>Connect through the provider to authorize and verify your account.</p>
                      {!snapshot.system.social?.find((item) => item.provider === draft.provider)?.configured && <p>OAuth app setup is required. Connect for the exact setup error.</p>}
                      <Button variant="primary" disabled={busy} onClick={() => void socialAction(draft.provider, "connect")}>Connect with {draft.provider === "x" ? "X" : label(draft.provider)}</Button>
                      <button type="button" className="text-link" onClick={() => setAdvancedSocial(true)}>Advanced: use a manual token</button>
                    </div>
                  ) : <>
                  <Field label="Connection label">
                    <input
                      required
                      value={draft.label}
                      onChange={(e) =>
                        setDraft({ ...draft, label: e.target.value })
                      }
                      placeholder="e.g. Studio account"
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
                  </>}
                </>
              )}
              <div className="modal-actions">
                <Button onClick={() => setModal(null)}>Cancel</Button>
                <Button
                  variant="primary"
                  type="submit"
                  disabled={
                    busy || (modal === "recording" && draft.mode === "jev") || (modal === "game" && !chosenGame && (gameImport.status !== "ready" || gameImport.input !== draft.url.trim())) ||
                    (modal === "connection" && socialProviders.includes(draft.provider) && !advancedSocial) ||
                    (modal === "post" && draft.deliveryMethod === "manual" && (!validTimeZone(localTimeZone) || !draft.scheduledAt || !Number.isFinite(Date.parse(draft.scheduledAt)))) ||
                    (modal === "post" &&
                      draft.deliveryMethod === "native" && draft.channel === "tiktok" &&
                      (!creator ||
                        !draft.tiktokPrivacy ||
                        !draft.tiktokConsent))
                  }
                >
                  {busy
                    ? "Saving…"
                    : modal === "game"
                      ? chosenGame
                        ? "Save changes"
                        : "Add game"
                      : modal === "recording"
                        ? "Queue recording"
                        : modal === "clip"
                          ? "Create clip"
                          : modal === "connection"
                            ? "Save connection"
                            : modal === "measurement"
                              ? "Record change"
                              : chosenPost
                                ? "Save changes"
                                : "Create draft"}
                </Button>
              </div>
            </form>
          )}
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
    <GameAutomation gameId={gameId} />
    <h3>Observed evidence</h3><p className="muted">Each fact retains its source and observation time. Owner details above are separate overrides; an unavailable source is listed under investigation needs.</p>
    {profile?.facts.length ? <ul className="profile-facts">{profile.facts.map((fact, index) => <li key={`${fact.key}-${index}`}><strong>{fact.label}</strong><span>{fact.value}</span><small>{fact.evidence.source} · {dateTime(fact.evidence.observedAt)}{fact.evidence.formatVersion !== undefined ? ` · Format v${fact.evidence.formatVersion}` : ""}{fact.evidence.sha256 ? ` · SHA-256 ${fact.evidence.sha256}` : ""}{fact.evidence.recordingId ? ` · Recording ${fact.evidence.recordingId}${fact.evidence.at !== undefined ? ` at ${timecode(fact.evidence.at)}` : ""}` : ""}{fact.evidence.url && /^https?:\/\//i.test(fact.evidence.url) && <> · <a href={fact.evidence.url} target="_blank" rel="noreferrer">Source</a></>}</small></li>)}</ul> : <p className="muted">No observed facts available yet.</p>}
  </section>;
}

type GameAutomationData = {
  enabled: boolean; intervalHours: number; ready: boolean; reasons: string[];
  draftReady: boolean; draftReasons: string[]; adapterVerified: boolean;
  lastQueuedAt: string | null; activeRecordingId: string | null; nextDueAt: string | null;
};
function GameAutomation({ gameId }: { gameId: string }) {
  const [data, setData] = useState<GameAutomationData | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [interval, setIntervalHours] = useState("24");
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const response = await fetch(`/api/games/${encodeURIComponent(gameId)}/automation`, { cache: "no-store" });
        const next = await response.json();
        if (!response.ok) throw new Error(next.error || "Could not load automation");
        if (!cancelled) { setData(next); setIntervalHours(String(next.intervalHours)); setError(""); }
      } catch (e) { if (!cancelled) setError(e instanceof Error ? e.message : "Could not load automation"); }
    };
    setData(null); void load();
    return () => { cancelled = true; };
  }, [gameId]);
  const update = async (changes: { enabled?: boolean; intervalHours?: number }) => {
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/games/${encodeURIComponent(gameId)}/automation`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(changes) });
      const next = await response.json();
      if (!response.ok) throw new Error(next.error || "Could not update automation");
      setData(next); setIntervalHours(String(next.intervalHours));
    } catch (e) { setError(e instanceof Error ? e.message : "Could not update automation"); }
    finally { setBusy(false); }
  };
  return <div className="game-automation">
    <div className="profile-heading"><div><h3>Automatic recordings</h3><p>{!data ? "Checking readiness…" : !data.enabled ? "Paused" : data.activeRecordingId ? "Recording queued or running" : data.ready ? "Ready" : "Waiting for setup"}</p></div>
      {data && <Button disabled={busy} onClick={() => void update({ enabled: !data.enabled })}>{data.enabled ? "Pause" : "Enable"}</Button>}</div>
    {error && <p className="profile-error" role="alert">{error}</p>}
    {data && <>
      <p>Adapter: {data.adapterVerified ? "Verified by a Jev recording" : "Not verified"}. A game URL alone does not verify compatibility.</p>
      {!!data.reasons.length && <ul>{data.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>}
      <p>Content drafts: {data.draftReady ? "Ready" : "Waiting"}{data.draftReasons.length ? ` · ${data.draftReasons.join("; ")}` : ""}. Posts still require approval.</p>
      <p>Last queued: {data.lastQueuedAt ? dateTime(data.lastQueuedAt) : "Never"} · Next due: {data.nextDueAt ? dateTime(data.nextDueAt) : "Not scheduled"}</p>
      <form className="automation-interval" onSubmit={(e) => { e.preventDefault(); void update({ intervalHours: Number(interval) }); }}>
        <Field label="Recording interval (hours)"><input type="number" min="6" max="24" step="1" required value={interval} onChange={(e) => setIntervalHours(e.target.value)} /></Field>
        <Button type="submit" disabled={busy || Number(interval) === data.intervalHours}>Save interval</Button>
      </form>
    </>}
  </div>;
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
  analytics: "Play funnels, traffic sources and player returns.",
  forever: "Private Forever website visits, game entry, and classified issues.",
  sessions: "Inspect individual player journeys and event sequences.",
  recordings: "Turn recorded gameplay into reusable highlights.",
  content: "Prepare content for review and publication.",
  calendar: "Plan and manage upcoming posts.",
  research: "Evidence, next steps and the result to check afterward.",
  connections: "Connect games, publishing accounts and research sources.",
  account: "Manage your workspace AI provider, model and Jev key.",
  discovery: "Review the public page, search setup and answer content for one game.",
  help: "Get your workspace ready and understand the workflow.",
};
const modalTitles: Record<Exclude<Modal, null>, string> = {
  game: "Add a game",
  recording: "Queue a recording",
  clip: "Create a clip",
  post: "Post details",
  connection: "Add a connection",
  review: "Review post",
  measurement: "Record a game change",
};
const modalDetails: Record<Exclude<Modal, null>, string> = {
  game: "Start with a public web game URL.",
  recording: "A worker processes queued recordings.",
  clip: "Choose a bounded segment from the recording.",
  post: "Prepare content for a connected channel.",
  connection: "Add an authorized provider credential.",
  review: "Check the content and publishing details.",
  measurement: "Record what changed, then compare player activity over time.",
};
const providerDescriptions: Record<string, string> = {
  jev: "Agent gameplay decisions",
  anthropic: "Content drafts and history-informed research",
  x: "Posting and public research",
  youtube: "Video publishing",
  instagram: "Publishing to an authorized account",
  tiktok: "Video publishing; app review may apply",
  reddit: "Public-source research",
  brave:
    "Optional public web discovery; unconnected sources remain coverage gaps",
  search_console:
    "Google Search Console property data; requires an authorized token and property URL",
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
function PostRecommendation({ post }: { post: Post }) {
  if (!post.recommendation) return null;
  return <div className="post-recommendation"><strong>{label(post.recommendation.confidence)} confidence starting point</strong><p>{post.recommendation.reason}</p><p>{post.recommendation.time}</p></div>;
}
function ManualPostNote({ post }: { post: Post }) {
  if (post.manualConfirmedAt && post.manualPublishedAt) return <small>Manual · User-confirmed {dateTime(post.manualPublishedAt)} · Not platform verified</small>;
  if (post.manualExportedAt) return <small>Manual · Export prepared {dateTime(post.manualExportedAt)} · Not published</small>;
  return <small>Manual · Awaiting export</small>;
}
function PostRow({
  post: p,
  games,
  onEdit,
  onReview,
}: {
  post: Post;
  games: Game[];
  onEdit: () => void;
  onReview: () => void;
}) {
  return (
    <div className="post-row">
      <div className="post-channel">
        {p.channel === "x" ? "X" : p.channel.slice(0, 1).toUpperCase()}
      </div>
      <div className="post-copy">
        <div className="post-meta">
          <strong>{p.channel === "x" ? "X" : label(p.channel)}</strong>
          <span>·</span>
          <span>{gameName(games, p.gameId)}</span>
          <span>·</span>
          <span>{dateTime(p.scheduledAt)}</span>
        </div>
        <p>{p.text}</p>
        {p.deliveryMethod === "manual" && <ManualPostNote post={p} />}
        {p.recommendation && <PostRecommendation post={p} />}
        {p.error && <small className="error-text">{p.error}</small>}
      </div>
      <Status value={p.status} />
      <Button onClick={onReview}>Review</Button>
      <button className="icon-button" aria-label="Edit post" onClick={onEdit}>
        <MoreHorizontal size={19} />
      </button>
    </div>
  );
}
function Calendar({
  posts,
  games,
  mode,
  offset,
  onSelect,
}: {
  posts: Post[];
  games: Game[];
  mode: "week" | "month" | "list";
  offset: number;
  onSelect: (p: Post) => void;
}) {
  const base = new Date();
  base.setHours(0, 0, 0, 0);
  if (mode === "month") {
    base.setDate(1);
    base.setMonth(base.getMonth() + offset);
  } else base.setDate(base.getDate() + offset * 7);
  const start = new Date(base);
  if (mode === "week")
    start.setDate(base.getDate() - ((base.getDay() + 6) % 7));
  if (mode === "month") start.setDate(1 - ((base.getDay() + 6) % 7));
  const dates = Array.from({ length: mode === "month" ? 42 : 7 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return d;
  });
  const scheduled = posts
    .filter((p) => p.scheduledAt)
    .sort(
      (a, b) =>
        new Date(a.scheduledAt!).getTime() - new Date(b.scheduledAt!).getTime(),
    );
  return (
    <>
      <div className="calendar-label">
        {mode === "month"
          ? base.toLocaleDateString(undefined, {
              month: "long",
              year: "numeric",
            })
          : mode === "week"
            ? `${shortDate(start.toISOString())} – ${shortDate(dates[6].toISOString())}`
            : "All scheduled posts"}
      </div>
      {mode === "list" ? (
        <div className="post-list">
          {scheduled.map((p) => (
            <PostRow
              key={p.id}
              post={p}
              games={games}
              onEdit={() => onSelect(p)}
              onReview={() => onSelect(p)}
            />
          ))}
          {!scheduled.length && (
            <p className="table-empty">No posts scheduled.</p>
          )}
        </div>
      ) : (
        <div className={`calendar-grid ${mode}`}>
          {dates.map((d, i) => {
            const dayPosts = scheduled.filter(
              (p) =>
                new Date(p.scheduledAt!).toDateString() === d.toDateString(),
            );
            return (
              <div
                className={`calendar-day ${d.toDateString() === new Date().toDateString() ? "today" : ""} ${mode === "month" && d.getMonth() !== base.getMonth() ? "other-month" : ""}`}
                key={i}
              >
                <div className="day-label">
                  {mode === "week" && (
                    <span>
                      {d.toLocaleDateString(undefined, { weekday: "short" })}
                    </span>
                  )}
                  <strong>{d.getDate()}</strong>
                </div>
                {dayPosts.map((p) => (
                  <button
                    className="calendar-post"
                    key={p.id}
                    onClick={() => onSelect(p)}
                  >
                    <strong>
                      {p.channel === "x" ? "X" : label(p.channel)}
                    </strong>
                    <span>
                      {new Date(p.scheduledAt!).toLocaleTimeString(undefined, {
                        hour: "numeric",
                        minute: "2-digit",
                      })}{" "}
                      · {gameName(games, p.gameId)}
                    </span>
                    <Status value={p.status} />
                    {p.deliveryMethod === "manual" && <ManualPostNote post={p} />}
                    {p.recommendation && <PostRecommendation post={p} />}
                  </button>
                ))}
              </div>
            );
          })}
        </div>
      )}
    </>
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
          detail="Follow the workflow from setup to reviewed publication."
        />
        <div className="help-step">
          <span>01</span>
          <div>
            <h3>Add a game</h3>
            <p>
              Add a public game-page URL. Blaze reads that path’s /forever.json
              to import its metadata. Metadata import does not collect gameplay
              events. Use a separate test workspace for controlled fixtures.
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
                <p className="data-note">Use the public SDK key in <code>Blaze.init</code>. The Game ID identifies API records. Never place private provider keys, worker tokens or server credentials in game code.</p>
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
            <h3>Configure network access and player capture</h3>
            <p>In Edit game, add exact HTTPS resource origins and opt-in WSS origins needed by the browser worker. Only verified public destinations are allowed; unknown, private and local destinations are blocked.</p>
            <p>Player capture is off by default. Review a unique origin-clean canvas and add privacy masks before enabling it. Ask for recording consent separately from analytics consent; call <code>await Blaze.startCapture(&#123;consent:true&#125;)</code> only after both are granted. Stop with <code>await Blaze.stopCapture()</code>, or discard with <code>await Blaze.stopCapture(&#123;discard:true&#125;)</code>. Analytics withdrawal also discards capture.</p>
            <p>Capture is sampled and limited to up to four 30-second segments at 5 fps, 960 × 540, and 3 MiB each. Gaps and upload failures may leave parts unrecorded. It contains the canvas only, no audio or DOM. Inspect private footage in Sessions; it is separate from agent recordings and content clips.</p>
          </div>
        </div>
        <div className="help-step">
          <span>03</span>
          <div>
            <h3>Connect providers and worker</h3>
            <p>
              In Account settings, add Jev for gameplay decisions and choose an AI provider and model for drafts and
              research suggestions. Each request uses this game's past posts,
              observed campaign traffic, player trends and measured changes.
              Missing data and small samples limit conclusions. Run
              the separate browser worker with authenticated access and
              configure storage. Jev needs a supported state and action adapter;
              a URL alone is insufficient.
            </p>
          </div>
        </div>
        <div className="help-step">
          <span>04</span>
          <div>
            <h3>Record and create clips</h3>
            <p>
              Queue a recording, inspect its footage and observations, then
              choose timestamps and a layout for a clip. Fixture mode tests the
              controlled sample and is not a Jev validation.
            </p>
          </div>
        </div>
        <div className="help-step">
          <span>05</span>
          <div>
            <h3>Review before publishing</h3>
            <p>
              Connect an authorized channel account, prepare a draft and request
              review. Approval binds the text, account, clip and planned time.
              Editing requires another approval. Check provider status for
              publication or failure.
            </p>
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
        <div className="health-row">
          <span>Recording worker</span>
          <Status value={system.worker ? "connected" : "disconnected"} />
        </div>
        <div className="health-row">
          <span>Publishing</span>
          <Status
            value={system.publishingEnabled ? "enabled" : "disconnected"}
          />
        </div>
        <p className="muted">
          Daily schedule: {system.dailySchedule || "Not configured"}
        </p>
      </aside>
    </div>
  );
}
