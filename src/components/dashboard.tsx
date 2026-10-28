"use client";

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
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type {
  Analytics,
  Channel,
  Clip,
  Finding,
  Game,
  Post,
  Recording,
  SessionSummary,
  SessionCapture,
  TelemetryEvent,
  WorkspaceSnapshot,
} from "@/lib/types";

type Page =
  | "overview"
  | "games"
  | "analytics"
  | "sessions"
  | "recordings"
  | "content"
  | "calendar"
  | "research"
  | "connections"
  | "help";
type Modal =
  | "game"
  | "recording"
  | "clip"
  | "post"
  | "connection"
  | "review"
  | "measurement"
  | null;
type Measurement = {
  id: string;
  gameId: string;
  findingId: string;
  note: string;
  startedAt: string;
  baseline: {
    sessions: number;
    starts: number;
    completions: number;
    errorSessions: number;
  };
  after: {
    sessions: number;
    starts: number;
    completions: number;
    errorSessions: number;
  };
  daysObserved: number;
};
const nav: { id: Page; label: string; icon: typeof Activity }[] = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "games", label: "Games", icon: Gamepad2 },
  { id: "analytics", label: "Player analytics", icon: BarChart3 },
  { id: "sessions", label: "Sessions", icon: Users },
  { id: "recordings", label: "Recordings & clips", icon: Clapperboard },
  { id: "content", label: "Content studio", icon: FileText },
  { id: "calendar", label: "Calendar", icon: CalendarDays },
  { id: "research", label: "Research", icon: Search },
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
const observedDays = (n: number) =>
  n < 1 ? "<1" : String(Math.min(14, Math.floor(n)));
const timecode = (n: number) =>
  `${Math.floor(n / 60)}:${String(Math.floor(n % 60)).padStart(2, "0")}`;
const label = (v: string) =>
  v.replaceAll("_", " ").replace(/^\w/, (c) => c.toUpperCase());
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
  const [googleConfigured, setGoogleConfigured] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [snapshot, setSnapshot] = useState<WorkspaceSnapshot | null>(null),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [page, setPage] = useState<Page>("overview"),
    [selectedGame, setSelectedGame] = useState("all"),
    [period, setPeriod] = useState("30"),
    [mobileNav, setMobileNav] = useState(false),
    [modal, setModal] = useState<Modal>(null);
  const [chosenGame, setChosenGame] = useState<Game | null>(null);
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
    [sessionLoading, setSessionLoading] = useState(false),
    [sessionError, setSessionError] = useState("");
  const sessionVideo = useRef<HTMLVideoElement>(null);
  const sessionRequest = useRef(0);
  const formError = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (error && modal) formError.current?.scrollIntoView({ block: "nearest" });
  }, [error, modal]);
  const [origin, setOrigin] = useState("");
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
    text: "",
    accountId: "",
    scheduledAt: "",
    provider: "jev",
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
  });
  const refresh = useCallback(
    async (game = selectedGame, demo = snapshot?.demo) => {
      try {
        const query = new URLSearchParams({ days: period });
        if (game !== "all") query.set("gameId", game);
        const url = `${demo ? "/api/demo" : "/api/workspace"}?${query}`;
        const res = await fetch(url, { cache: "no-store" });
        if (res.status === 401) {
          const example = await fetch("/api/demo", { cache: "no-store" });
          if (example.ok) {
            const data = await example.json();
            setGoogleConfigured(data.system.google);
            setSnapshot(data);
            setUpdatedAt(new Date());
            setError("");
          } else setSnapshot(null);
          return;
        }
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Could not load workspace");
        setGoogleConfigured(data.system.google);
        setSnapshot(data);
        setUpdatedAt(new Date());
        setError("");
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not load workspace");
      } finally {
        setLoading(false);
      }
    },
    [selectedGame, snapshot?.demo, period],
  );
  useEffect(() => {
    setOrigin(window.location.origin);
    void refresh();
  }, []); // Initial workspace or sign-in state.
  useEffect(() => {
    if (snapshot) void refresh(selectedGame, snapshot.demo);
  }, [selectedGame, period]);
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
        ? { ...current, status: fresh.status, error: fresh.error }
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
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Action failed");
      if (close) setModal(null);
      await refresh();
      setNotice("Changes saved.");
      return data;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Action failed");
      return false;
    } finally {
      setBusy(false);
    }
  };
  const showDemo = async () => {
    setLoading(true);
    await refresh("all", true);
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
    setPage(p);
    setMobileNav(false);
    sessionRequest.current++;
    setChosenSession(null);
  };
  const closeSession = () => {
    sessionRequest.current++;
    setChosenSession(null);
  };
  const openSession = async (s: SessionSummary) => {
    const request = ++sessionRequest.current;
    setChosenSession(s);
    setSessionEvents([]);
    setSessionCapture(null);
    setSessionError("");
    if (snapshot?.demo) { setSessionLoading(false); return; }
    setSessionLoading(true);
    try {
      const query = new URLSearchParams({ gameId: s.gameId });
      const r = await fetch(`/api/sessions/${encodeURIComponent(s.id)}?${query}`, { cache: "no-store" });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Unable to load session");
      if (request === sessionRequest.current) {
        setSessionEvents(d.events || []);
        setSessionCapture(d.capture || null);
      }
    } catch (e) {
      if (request === sessionRequest.current) setSessionError(e instanceof Error ? e.message : "Unable to load session");
    } finally {
      if (request === sessionRequest.current) setSessionLoading(false);
    }
  };
  const resetDraft = () => {
    setCreator(null);
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
      text: "",
      accountId: "",
      scheduledAt: "",
      provider: "jev",
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
    selectedGame === "all" ? games : games.filter((g) => g.id === selectedGame);
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
  const since = Date.now() - Number(period) * 86400000;
  const sessions = (analytics?.sessionsList || []).filter(
    (x) => new Date(x.startedAt).getTime() >= since,
  );
  const trend = (analytics?.trend || []).filter(
    (x) => new Date(x.date).getTime() >= since,
  );
  const title =
    nav.find((n) => n.id === page)?.label ||
    (page === "connections" ? "Connections" : "Setup & help");
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
              url: draft.url,
              title: draft.title || undefined,
              image: draft.image || undefined,
              genre: draft.genre || undefined,
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
    else if (modal === "measurement" && chosenFinding)
      await action({
        action: "start_measurement",
        findingId: chosenFinding.id,
        note: draft.note,
      });
    else if (modal === "connection")
      await action({
        action: "save_connection",
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
        text: draft.text,
        accountId: draft.accountId,
        scheduledAt: draft.scheduledAt
          ? new Date(draft.scheduledAt).toISOString()
          : null,
        ...(draft.channel === "tiktok" && draft.tiktokPrivacy
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
          <p className="eyebrow">WEB GAME STUDIO</p>
          <h1>
            Know what happens
            <br />
            after play begins.
          </h1>
          <p>
            Bring your games, player evidence and content workflow into one
            place.
          </p>
          {googleConfigured ? (
            <a className="button primary sign-button" href="/api/auth/google">
              Continue with Google <ArrowRight size={16} />
            </a>
          ) : (
            <>
              <Button variant="primary" disabled>
                Google sign-in not configured
              </Button>
              <p className="signin-setup">
                Create a Google OAuth web application, add this callback URL,
                and set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET on the server:{" "}
                <code>
                  {origin || "YOUR_WORKSPACE_ORIGIN"}/api/auth/callback/google
                </code>
                .
              </p>
            </>
          )}
          {process.env.NEXT_PUBLIC_LOCAL_DEV === "true" && (
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
      <aside className={`sidebar ${mobileNav ? "open" : ""}`}>
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
            { title: "Player evidence", items: nav.slice(0, 4) },
            { title: "Production", items: nav.slice(4) },
          ].map((group) => (
            <div className="nav-group" key={group.title}>
              <div className="nav-label">{group.title}</div>
              {group.items.map((n) => (
                <button
                  key={n.id}
                  onClick={() => changePage(n.id)}
                  className={`nav-item ${page === n.id ? "active" : ""}`}
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
                  setSnapshot(null);
                  return;
                }
                await fetch("/api/auth/logout", { method: "POST" });
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
            <Button variant="primary" onClick={() => openModal("game")}>
              <Plus size={16} /> Add game
            </Button>
          </div>
        </header>
        {snapshot.demo && (
          <div className="demo-banner">
            <strong>Example workspace</strong>
            <span>
              Illustrative data, not your games or analytics. Changes are
              disabled.
            </span>
            <button onClick={() => setSnapshot(null)}>
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
        <main className="main-content">
          <div className="page-heading">
            <div>
              <h1>{title}</h1>
              <p>{pageDescriptions[page]}</p>
            </div>
            {page !== "connections" && page !== "help" && (
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
                <label>
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
                </label>
              </div>
            )}
          </div>
          {page === "overview" && (
            <>
              <div className="overview-top">
                <div className="overview-main">
                  <SectionHead
                    title="Player activity"
                    detail="Human traffic · selected date range"
                    action={
                      <button
                        className="inline-link"
                        onClick={() => changePage("analytics")}
                      >
                        View analytics <ArrowRight size={15} />
                      </button>
                    }
                  />
                  <Metrics a={analytics} />
                  <Chart data={trend} />
                </div>
                <aside className="overview-side">
                  <div className="featured-game">
                    <div className="featured-heading">
                      <h2>{selectedGame === "all" ? "Game in focus" : "Selected game"}</h2>
                      {snapshot.demo && <span className="featured-example">Example</span>}
                    </div>
                    {featuredGame ? (
                      <>
                        <Media src={featuredGame.image} title={featuredGame.title} />
                        <div className="featured-copy">
                          <h3>{featuredGame.title}</h3>
                          <p>{featuredGame.genre || "Web game"}{featuredGame.genre === "Fixture" ? " · Controlled fixture" : ""}</p>
                        </div>
                        <div className="featured-actions">
                          <Button onClick={() => { setSelectedGame(featuredGame.id); changePage("analytics"); }}>
                            View analytics <ArrowRight size={14} />
                          </Button>
                          <Button onClick={() => {
                            setSelectedGame(featuredGame.id);
                            openModal("recording");
                            setDraft((d) => ({ ...d, gameId: featuredGame.id }));
                          }}>
                            <Video size={14} /> Record game
                          </Button>
                        </div>
                      </>
                    ) : (
                      <div className="featured-empty">
                        <p>No game selected or added yet.</p>
                        <button className="inline-link" onClick={() => openModal("game")}>Add a game <ArrowRight size={14} /></button>
                      </div>
                    )}
                    <div className="featured-status">
                      <div><span>Recording worker</span><Status value={snapshot.system.worker ? "connected" : "disconnected"} /></div>
                      <div><span>Posts awaiting review</span><strong>{posts.filter((p) => p.status === "review").length}</strong></div>
                    </div>
                  </div>
                </aside>
              </div>
              <div className="lower-grid">
                <div>
                  <SectionHead
                    title="Recent sessions"
                    detail={`Human sessions · last ${period} days`}
                    action={
                      <button
                        className="inline-link"
                        onClick={() => changePage("sessions")}
                      >
                        All sessions <ArrowRight size={15} />
                      </button>
                    }
                  />
                  <SessionsTable
                    sessions={sessions.slice(0, 5)}
                    games={games}
                    onSelect={openSession}
                  />
                </div>
                <div>
                  <SectionHead
                    title="Open findings"
                    detail="Evidence and hypotheses to review"
                    action={
                      <button
                        className="inline-link"
                        onClick={() => changePage("research")}
                      >
                        View research <ArrowRight size={15} />
                      </button>
                    }
                  />
                  <Findings
                    findings={findings
                      .filter((f) => f.status !== "resolved")
                      .slice(0, 3)}
                    action={action}
                  />
                </div>
              </div>
              <section className="overview-queue">
                <SectionHead title="Publishing queue" detail="Scheduled posts and their current status." action={
                  <button className="inline-link" onClick={() => changePage("calendar")}>Open calendar <ArrowRight size={15} /></button>
                } />
                {posts.filter((p) => p.scheduledAt).slice(0, 3).map((p) => (
                  <button className="queue-row" key={p.id} onClick={() => reviewPost(p)}>
                    <div><strong>{label(p.channel)}</strong><span>{gameName(games, p.gameId)} · {dateTime(p.scheduledAt)}</span></div>
                    <Status value={p.status} />
                  </button>
                ))}
                {!posts.some((p) => p.scheduledAt) && <p className="muted">No scheduled posts yet.</p>}
              </section>
            </>
          )}
          {page === "games" && (
            <>
              <SectionHead
                title="Your games"
                detail="Add a public web game URL to begin setup."
                action={
                  <Button variant="primary" onClick={() => openModal("game")}>
                    <Plus size={16} /> Add game
                  </Button>
                }
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
                        <span className="tag">
                          {g.genre || "Web game"}
                        </span>{" "}
                        <span className="muted">
                          Added {shortDate(g.createdAt)}
                        </span>
                      </div>
                      <div className="game-actions">
                        <Button onClick={() => editGame(g)}>Edit</Button>
                        <Button
                          onClick={() => {
                            setSelectedGame(g.id);
                            changePage("analytics");
                          }}
                        >
                          Analytics <ArrowRight size={14} />
                        </Button>
                        <Button
                          onClick={() => {
                            setSelectedGame(g.id);
                            changePage("help");
                          }}
                        >
                          SDK setup
                        </Button>
                      </div>
                    </div>
                  ))}
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
          {page === "analytics" && (
            <>
              <SectionHead
                title="Human player activity"
                detail="Human traffic in the selected date range."
              />
              <Metrics a={analytics} />
              <div className="analytics-grid">
                <div>
                  <Chart data={trend} />
                  <SectionHead
                    title="Player funnel"
                    detail="Counts follow the recorded order of events."
                  />
                  <div className="funnel">
                    {(analytics?.funnel || []).map((f, i) => (
                      <div key={f.name}>
                        <span>{f.name}</span>
                        <div className="funnel-track">
                          <div
                            style={{
                              width: `${Math.max(0, Math.min(100, (f.count / (analytics?.funnel?.[0]?.count || 1)) * 100))}%`,
                            }}
                          />
                        </div>
                        <strong>{fmt(f.count)}</strong>
                        {i > 0 && (
                          <small>
                            {analytics?.funnel?.[0]?.count
                              ? Math.round(
                                  (f.count / analytics.funnel[0].count) * 100,
                                )
                              : 0}
                            %
                          </small>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
                <div className="analytics-aside">
                  <Breakdown
                    title="Countries"
                    items={analytics?.countries || []}
                  />
                  <Breakdown
                    title="Traffic sources"
                    items={analytics?.sources || []}
                  />
                  <Breakdown title="Devices" items={analytics?.devices || []} />
                </div>
              </div>
              <div className="data-note">
                Human traffic only. {fmt(analytics?.syntheticSessions)}{" "}
                synthetic sessions excluded. Last event:{" "}
                {analytics?.lastEventAt
                  ? dateTime(analytics.lastEventAt)
                  : "No events yet"}
                . Country and attribution may be unavailable.
              </div>
              <div className="lower-grid">
                <div>
                  <SectionHead
                    title="Drop-off points"
                    detail="Last recorded step for sessions without a completed round."
                  />
                  <Breakdown
                    title="Last step"
                    items={analytics?.dropoffs || []}
                  />
                </div>
                <div>
                  <SectionHead
                    title="Campaign attribution"
                    detail="Counts reflect attributed sessions, not causal impact."
                  />
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>CAMPAIGN</th>
                          <th>VISITS</th>
                          <th>STARTS</th>
                          <th>COMPLETIONS</th>
                          <th>RETURNS</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(analytics?.campaigns || []).map((c) => {
                          const post = posts.find(
                            (p) => p.campaignId === c.name,
                          );
                          return (
                            <tr key={c.name}>
                              <td>
                                {post ? (
                                  <>
                                    <strong>
                                      {post.channel === "x"
                                        ? "X"
                                        : label(post.channel)}
                                    </strong>
                                    <small>
                                      {post.text.slice(0, 80)}
                                      {post.text.length > 80 ? "…" : ""}
                                    </small>
                                    <small>{c.name}</small>
                                  </>
                                ) : (
                                  c.name
                                )}
                              </td>
                              <td>{c.visits}</td>
                              <td>{c.starts}</td>
                              <td>{c.completions}</td>
                              <td>{c.returns}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                    {!analytics?.campaigns?.length && (
                      <p className="table-empty">
                        No attributed campaigns in this range.
                      </p>
                    )}
                  </div>
                </div>
              </div>
              <div className="section-spacer">
                <SectionHead
                  title="Pointer density"
                  detail="Normalized screen coordinates across human sessions. This is not a semantic game replay."
                />
                {selectedGame === "all" ? (
                  <p className="table-empty">
                    Select one game to inspect pointer density.
                  </p>
                ) : analytics?.heatmap?.length ? (
                  <div className="heatmap">
                    <div className="heatmap-grid">
                      {analytics.heatmap
                        .filter((p) => p.gameId === selectedGame)
                        .map((p, i) => (
                          <span
                            key={i}
                            title={`${p.count} interactions`}
                            style={{
                              left: `${p.x * 100}%`,
                              top: `${p.y * 100}%`,
                              opacity: Math.min(0.9, 0.25 + p.count / 10),
                            }}
                          />
                        ))}
                    </div>
                    <p className="muted">
                      Dots show sampled pointer positions. Screen size and
                      layout may vary between sessions.
                    </p>
                  </div>
                ) : (
                  <p className="table-empty">
                    No pointer samples in this range.
                  </p>
                )}
              </div>
              <SectionHead
                title="Return cohorts"
                detail="Return rates use eligible players in mature cohorts."
              />
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>COHORT</th>
                      <th>PLAYERS</th>
                      <th>ELIGIBLE</th>
                      <th>RETURNED</th>
                      <th>RETURN RATE</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(analytics?.retention || []).map((r) => (
                      <tr key={r.date}>
                        <td>{r.date}</td>
                        <td>{fmt(r.players)}</td>
                        <td>{fmt(r.eligible)}</td>
                        <td>{fmt(r.returned)}</td>
                        <td>
                          {r.rate === null
                            ? "Not mature"
                            : `${Math.round(r.rate * 100)}%`}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!analytics?.retention?.length && (
                  <p className="table-empty">No eligible cohorts yet.</p>
                )}
              </div>
            </>
          )}
          {page === "sessions" && (
            <>
              <SectionHead
                title="Session explorer"
                detail="Human sessions in the selected date range. Select a row to inspect events and any consented canvas capture."
              />
              <SessionsTable
                sessions={sessions}
                games={games}
                onSelect={openSession}
              />
            </>
          )}
          {page === "recordings" && (
            <>
              <SectionHead
                title="Recordings"
                detail="Recorded browser gameplay and timestamped observations."
                action={
                  <Button
                    variant="primary"
                    onClick={() => openModal("recording")}
                  >
                    <Plus size={16} /> Queue recording
                  </Button>
                }
              />
              {records.length ? (
                <div className="recording-grid">
                  {records.map((r) => (
                    <button
                      className={`recording-item ${chosenRecording?.id === r.id ? "selected" : ""}`}
                      key={r.id}
                      onClick={() => {
                        setChosenRecording(r);
                        setChosenClip(null);
                        setSeekAt(undefined);
                      }}
                    >
                      <Media src={r.screenshotUrl} title={r.title} />
                      <div className="recording-caption">
                        <div>
                          <strong>{r.title}</strong>
                          <span>
                            {gameName(games, r.gameId)} ·{" "}
                            {shortDate(r.createdAt)}
                          </span>
                        </div>
                        <Status value={r.status} />
                      </div>
                      <div className="recording-meta">
                        {r.mode === "fixture" ? "Fixture decisions" : "Jev"} ·{" "}
                        {r.duration ? timecode(r.duration) : "Duration pending"}
                      </div>
                    </button>
                  ))}
                </div>
              ) : (
                <Empty
                  title="No recordings yet"
                  detail="Queue a fixture run to test the recording workflow, or configure Jev and a game adapter."
                  action={
                    <Button onClick={() => openModal("recording")}>
                      Queue recording
                    </Button>
                  }
                />
              )}{" "}
              {chosenRecording && (
                <div className="detail-panel">
                  <div className="detail-heading">
                    <div>
                      <div className="eyebrow">RECORDING DETAIL</div>
                      <h2>{chosenRecording.title}</h2>
                      <p>
                        {chosenRecording.mode === "fixture"
                          ? "Controlled fixture run"
                          : "Jev run"}{" "}
                        · {shortDate(chosenRecording.createdAt)}
                      </p>
                    </div>
                    <Button
                      onClick={() => openClip(chosenRecording)}
                      disabled={chosenRecording.status !== "ready"}
                    >
                      <Plus size={15} /> Create clip
                    </Button>
                  </div>
                  <div className="recording-detail">
                    <Media
                      src={
                        chosenRecording.videoUrl ||
                        chosenRecording.screenshotUrl
                      }
                      video={!!chosenRecording.videoUrl}
                      title={chosenRecording.title}
                      startAt={seekAt}
                    />
                    {seekAt !== undefined && (
                      <p className="muted">
                        Evidence timestamp: {timecode(seekAt)}
                        {!chosenRecording.videoUrl
                          ? " · Video unavailable"
                          : ""}
                      </p>
                    )}
                    <div>
                      <h3>Observations</h3>
                      <p className="muted">
                        Notes from the run; hypotheses need human validation.
                      </p>
                      {chosenRecording.observations?.length ? (
                        chosenRecording.observations.map((o, i) => (
                          <button
                            className="observation"
                            key={i}
                            onClick={() => {
                              openClip(chosenRecording);
                              setDraft((d) => ({
                                ...d,
                                start: String(o.at),
                                end: String(
                                  Math.min(
                                    chosenRecording.duration || o.at + 10,
                                    o.at + 10,
                                  ),
                                ),
                              }));
                            }}
                          >
                            <span>{timecode(o.at)}</span>
                            <div>
                              <strong>{label(o.type)}</strong>
                              <p>{o.text}</p>
                            </div>
                            <small>Use highlight</small>
                          </button>
                        ))
                      ) : (
                        <p className="muted">No observations recorded.</p>
                      )}
                      {chosenRecording.error && (
                        <div className="alert error">
                          {chosenRecording.error}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}
              <div className="section-spacer">
                <SectionHead
                  title="Clip library"
                  detail="Reusable clips from completed recordings."
                />
                {clips.length ? (
                  <div className="clip-list">
                    {clips.map((c) => (
                      <button
                        className="clip-row"
                        key={c.id}
                        onClick={() => setChosenClip(c)}
                      >
                        <div className="clip-icon">
                          <Play size={16} />
                        </div>
                        <div>
                          <strong>{c.title}</strong>
                          <span>
                            {gameName(games, c.gameId)} · {timecode(c.start)}–
                            {timecode(c.end)} · {label(c.layout)}
                          </span>
                        </div>
                        <Status value={c.status} />
                        <ChevronRight size={16} />
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="table-empty">
                    No clips yet. Select a ready recording to create one.
                  </p>
                )}
                {chosenClip && (
                  <div className="detail-panel">
                    <div className="detail-heading">
                      <div>
                        <h2>{chosenClip.title}</h2>
                        <p>
                          {timecode(chosenClip.start)}–
                          {timecode(chosenClip.end)} ·{" "}
                          {label(chosenClip.layout)}
                        </p>
                      </div>
                      <Button
                        onClick={() => {
                          resetDraft();
                          setDraft((d) => ({
                            ...d,
                            gameId: chosenClip.gameId,
                            clipId: chosenClip.id,
                          }));
                          setModal("post");
                        }}
                      >
                        Create post <ArrowRight size={15} />
                      </Button>
                    </div>
                    <Media
                      src={chosenClip.videoUrl}
                      video={!!chosenClip.videoUrl}
                      title={chosenClip.title}
                    />
                  </div>
                )}
              </div>
            </>
          )}
          {page === "content" && (
            <>
              <SectionHead
                title="Content studio"
                detail="Draft, review and approve the exact content before publishing."
                action={
                  <Button variant="primary" onClick={() => openModal("post")}>
                    <Plus size={16} /> New post
                  </Button>
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
            </>
          )}
          {page === "calendar" && (
            <>
              <div className="calendar-toolbar">
                <div>
                  <h2>Publishing calendar</h2>
                  <p>Planned times and publishing status</p>
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
          {page === "research" && (
            <>
              <SectionHead
                title="Findings"
                detail="Observations and hypotheses linked to supporting evidence."
                action={
                  <Button
                    variant="primary"
                    onClick={() => {
                      resetDraft();
                      setModal("recording");
                      setNotice(
                        "Use the research run button below for a selected game.",
                      );
                    }}
                  >
                    Record gameplay
                  </Button>
                }
              />
              <div className="research-run">
                <div>
                  <strong>Run research</strong>
                  <p>
                    Inspect available sources and workspace evidence for a game.
                  </p>
                </div>
                <select
                  aria-label="Game for research"
                  value={draft.gameId}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, gameId: e.target.value }))
                  }
                >
                  <option value="">Select game</option>
                  {games.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.title}
                    </option>
                  ))}
                </select>
                <Button
                  onClick={() =>
                    action({ action: "run_research", gameId: draft.gameId })
                  }
                  disabled={!draft.gameId || busy}
                >
                  Run research
                </Button>
              </div>
              <Findings
                findings={findings}
                action={action}
                full
                onMeasure={startMeasurement}
                onRecording={openRecordingEvidence}
              />
              <Measurements
                items={(
                  (
                    snapshot as WorkspaceSnapshot & {
                      measurements?: Measurement[];
                    }
                  ).measurements || []
                ).filter(
                  (m) => selectedGame === "all" || m.gameId === selectedGame,
                )}
                findings={findings}
              />
              <div className="section-spacer">
                <SectionHead
                  title="Run history"
                  detail="Source coverage and failures for each run."
                />
                {runs.length ? (
                  runs.map((r) => (
                    <div className="run-row" key={r.id}>
                      <div>
                        <strong>{gameName(games, r.gameId)}</strong>
                        <p>
                          {dateTime(r.startedAt)} · {r.coverage.length} sources
                        </p>
                        {r.coverage.map((c, i) => (
                          <small key={i}>
                            {c.source}: {c.status} — {c.detail}
                            <br />
                          </small>
                        ))}
                      </div>
                      <Status value={r.status} />
                    </div>
                  ))
                ) : (
                  <p className="table-empty">No research runs yet.</p>
                )}
              </div>
            </>
          )}
          {page === "connections" && (
            <>
              <SectionHead
                title="Connections"
                detail="Provider credentials are stored on the server. Account authorization and platform review may be required."
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
                  "jev",
                  "anthropic",
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
                        {con.map((c) => (
                          <small key={c.id}>
                            {c.label}
                            {c.accountId ? ` · ${c.accountId}` : ""}
                            {c.model ? ` · ${c.model}` : ""}{" "}
                            <button
                              onClick={() =>
                                action({
                                  action: "delete_connection",
                                  id: c.id,
                                })
                              }
                            >
                              Remove
                            </button>
                          </small>
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
              <div className="session-stats">
                <div>
                  <span>Duration</span>
                  <strong>{timecode(chosenSession.duration)}</strong>
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
                {sessionLoading ? <p className="muted">Loading capture…</p> : sessionError ? <p className="error-text">{sessionError}</p> : sessionCapture?.status === "ready" && sessionCapture.videoUrl ? (
                  <>
                    <video ref={sessionVideo} controls preload="metadata" src={sessionCapture.videoUrl} aria-label="Player canvas capture" />
                    <p className="muted">Started {dateTime(sessionCapture.recordedAt || sessionCapture.createdAt)}{!sessionCapture.recordedAt && " (approximate)"} · {sessionCapture.durationSeconds === undefined ? "Duration unavailable" : timecode(sessionCapture.durationSeconds)} · {sessionCapture.width && sessionCapture.height ? `${sessionCapture.width} × ${sessionCapture.height}` : "Dimensions unavailable"} · expires {dateTime(sessionCapture.expiresAt)}</p>
                    <p className="muted">Canvas only, with configured masks. Select an event within the capture to seek.</p>
                  </>
                ) : (
                  <p className="muted">{captureMessage(sessionCapture?.status || chosenSession.captureStatus, snapshot.demo, sessionCapture?.status === "ready")}{sessionCapture?.reason ? ` (${label(sessionCapture.reason)})` : ""}</p>
                )}
                {sessionCapture && !snapshot.demo && !["expired", "cancelled"].includes(sessionCapture.status) && (
                  <Button variant="danger" disabled={busy} onClick={() => {
                    if (window.confirm("Delete this player capture? This cannot be undone.")) {
                      void (async () => {
                        const result = await action({ action: "delete_session_capture", id: sessionCapture.id }, false);
                        if (result) await openSession(chosenSession);
                      })();
                    }
                  }}>Delete capture</Button>
                )}
              </div>
              <h3>Event timeline</h3>
              <p className="muted">Ordered activity captured by the SDK.</p>
              {sessionLoading ? (
                <p>Loading events…</p>
              ) : sessionError ? (
                <p className="error-text">{sessionError}</p>
              ) : sessionEvents.length ? (
                <div className="timeline">
                  {sessionEvents.map((e, i) => (
                    <div key={e.id || i}>
                      <span className="timeline-dot" />
                      <div>
                        {sessionCapture?.status === "ready" && sessionCapture.videoUrl && sessionCapture.durationSeconds !== undefined && Number.isFinite(Date.parse(e.timestamp)) && (() => {
                          const offset = (Date.parse(e.timestamp) - Date.parse(sessionCapture.recordedAt || sessionCapture.createdAt)) / 1000;
                          return Number.isFinite(offset) && offset >= 0 && offset <= sessionCapture.durationSeconds! ? (
                            <button className="timeline-seek" type="button" onClick={() => { if (sessionVideo.current) sessionVideo.current.currentTime = offset; }}>
                              {label(e.name)} <small>Seek to {timecode(offset)}</small>
                            </button>
                          ) : <strong>{label(e.name)}</strong>;
                        })()}
                        {!(sessionCapture?.status === "ready" && sessionCapture.videoUrl && sessionCapture.durationSeconds !== undefined && Number.isFinite(Date.parse(e.timestamp))) && <strong>{label(e.name)}</strong>}
                        <p>{dateTime(e.timestamp)}</p>
                        {e.properties &&
                          Object.keys(e.properties).length > 0 && (
                            <small>{JSON.stringify(e.properties)}</small>
                          )}
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
                  <dt>Account</dt>
                  <dd>{chosenPost.accountId || "Not selected"}</dd>
                  <dt>Clip</dt>
                  <dd>
                    {clips.find((c) => c.id === chosenPost.clipId)?.title ||
                      "None"}
                  </dd>
                  <dt>Planned time</dt>
                  <dd>{dateTime(chosenPost.scheduledAt)}</dd>
                  {chosenPost.channel === "tiktok" && (
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
                      chosenPost.channel === "tiktok" &&
                      (!chosenPost.tiktokConsent?.consent ||
                        !chosenPost.tiktokConsent?.privacy)
                    }
                    onClick={() =>
                      action({ action: "approve_post", id: chosenPost.id })
                    }
                  >
                    Approve post
                  </Button>
                )}
                {["approved", "scheduled"].includes(chosenPost.status) && (
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
                  <Field
                    label="Game URL"
                    hint="We’ll attempt to extract public metadata. You can override it below."
                  >
                    <input
                      required
                      disabled={!!chosenGame}
                      type="url"
                      placeholder="https://yourgame.com"
                      value={draft.url}
                      onChange={(e) =>
                        setDraft({ ...draft, url: e.target.value })
                      }
                    />
                  </Field>
                  <button
                    type="button"
                    className="inline-link fixture-link"
                    onClick={() =>
                      setDraft({
                        ...draft,
                        url: `${origin}/fixture/index.html`,
                        title: "Controlled fixture",
                        genre: "Fixture",
                      })
                    }
                  >
                    Use controlled fixture URL <ArrowRight size={14} />
                  </button>
                  <Field label="Title (optional)">
                    <input
                      placeholder="Game title"
                      value={draft.title}
                      onChange={(e) =>
                        setDraft({ ...draft, title: e.target.value })
                      }
                    />
                  </Field>
                  <Field label="Artwork URL (optional)">
                    <input
                      type="url"
                      placeholder="https://…"
                      value={draft.image}
                      onChange={(e) =>
                        setDraft({ ...draft, image: e.target.value })
                      }
                    />
                  </Field>
                  <Field label="Genre (optional)">
                    <input
                      placeholder="e.g. Puzzle"
                      value={draft.genre}
                      onChange={(e) =>
                        setDraft({ ...draft, genre: e.target.value })
                      }
                    />
                  </Field>
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
                    <Field label="Clip (optional)">
                      <select
                        value={draft.clipId}
                        onChange={(e) =>
                          setDraft({ ...draft, clipId: e.target.value })
                        }
                      >
                        <option value="">No clip</option>
                        {clips
                          .filter((c) => c.gameId === draft.gameId)
                          .map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.title}
                            </option>
                          ))}
                      </select>
                    </Field>
                  </div>
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
                            {c.label} · {c.accountId}
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
                  {draft.channel === "tiktok" && (
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
                    Generation requires a configured Anthropic connection.
                    Review all generated copy.
                  </p>
                  <Field label="Planned time (optional)">
                    <input
                      type="datetime-local"
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
                  <p className="muted">Finding: {chosenFinding?.title}</p>
                  <Field
                    label="What changed?"
                    hint="Describe the change clearly enough to interpret the before and after periods."
                  >
                    <textarea
                      required
                      rows={4}
                      value={draft.note}
                      onChange={(e) =>
                        setDraft({ ...draft, note: e.target.value })
                      }
                      placeholder="e.g. Simplified the first-round instructions"
                    />
                  </Field>
                  <div className="data-note">
                    The comparison uses the previous 14 days and up to 14 days
                    after this record. Observed changes do not establish
                    causation.
                  </div>
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
                        "jev",
                        "anthropic",
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
                  <Field label="Model (required for Anthropic)">
                    <input
                      value={draft.model}
                      onChange={(e) =>
                        setDraft({ ...draft, model: e.target.value })
                      }
                    />
                  </Field>
                  {draft.provider === "anthropic" && (
                    <Field
                      label="Anthropic workspace ID (optional)"
                      hint="Required for multi-workspace keys; omit for workspace-scoped keys."
                    >
                      <input
                        value={draft.workspaceId}
                        onChange={(e) =>
                          setDraft({ ...draft, workspaceId: e.target.value })
                        }
                      />
                    </Field>
                  )}
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
                    busy ||
                    (modal === "post" &&
                      draft.channel === "tiktok" &&
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

function Brand() {
  return (
    <div className="brand">
      <span className="brand-mark">
        <span />
        <span />
        <span />
        <span />
      </span>
      <span>
        Web Game
        <br />
        <b>Studio</b>
      </span>
    </div>
  );
}
const pageDescriptions: Record<Page, string> = {
  overview: "A clear view of player activity and the work ahead.",
  games: "Manage the games in your workspace.",
  analytics: "Understand where players start, continue and return.",
  sessions: "Inspect individual player journeys and event sequences.",
  recordings: "Turn recorded gameplay into reusable highlights.",
  content: "Prepare content for review and publication.",
  calendar: "Plan and manage upcoming posts.",
  research: "Explore evidence, source coverage and opportunities.",
  connections: "Manage providers, accounts and services.",
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
function Metrics({ a }: { a?: Analytics }) {
  return (
    <div className="metrics">
      <div>
        <span>Human sessions</span>
        <strong>{fmt(a?.sessions)}</strong>
        <small>Visits recorded</small>
      </div>
      <div>
        <span>Players</span>
        <strong>{fmt(a?.players)}</strong>
        <small>Distinct players</small>
      </div>
      <div>
        <span>Rounds started</span>
        <strong>{fmt(a?.starts)}</strong>
        <small>Started play</small>
      </div>
      <div>
        <span>Rounds completed</span>
        <strong>{fmt(a?.completions)}</strong>
        <small>Completed play</small>
      </div>
    </div>
  );
}
function Chart({ data }: { data: Analytics["trend"] }) {
  return (
    <div className="chart-block">
      <div className="chart-header">
        <div>
          <span className="chart-title">Activity over time</span>
          <span className="chart-sub">Selected date range</span>
        </div>
        <div className="legend">
          <span />
          <span>Visits</span>
        </div>
      </div>
      {data.length ? (
        <div className="chart">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart
              data={data}
              margin={{ top: 12, right: 8, left: -25, bottom: 0 }}
            >
              <CartesianGrid vertical={false} stroke="#e8eae6" />
              <XAxis
                dataKey="date"
                axisLine={false}
                tickLine={false}
                tick={{ fontSize: 10, fill: "#777f78" }}
                tickFormatter={(v) => String(v).slice(5)}
              />
              <YAxis
                allowDecimals={false}
                axisLine={false}
                tickLine={false}
                tick={{ fontSize: 10, fill: "#777f78" }}
              />
              <Tooltip
                contentStyle={{
                  border: "1px solid #dfe4df",
                  background: "#fff",
                  color: "#18241d",
                  borderRadius: 8,
                  fontSize: 12,
                }}
              />
              <Area
                type="monotone"
                dataKey="visits"
                stroke="#447f61"
                strokeWidth={2}
                fill="#e7f1e8"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <div className="chart-empty">No activity in this date range.</div>
      )}
    </div>
  );
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
        detail="14 days before versus up to 14 days after each recorded change. These comparisons do not establish causation."
      />
      {items.length ? (
        items.map((m) => (
          <div className="measurement" key={m.id}>
            <div className="measurement-heading">
              <div>
                <strong>{m.note}</strong>
                <p>
                  {findings.find((f) => f.id === m.findingId)?.title ||
                    "Recorded game change"}{" "}
                  · Started {shortDate(m.startedAt)}
                </p>
              </div>
              <span>{observedDays(m.daysObserved)} of 14 days observed</span>
            </div>
            <p className="mobile-scroll-hint">
              Scroll sideways to see all metrics.
            </p>
            <div className="table-wrap" tabIndex={0}>
              <table>
                <thead>
                  <tr>
                    <th>PERIOD</th>
                    <th>SESSIONS</th>
                    <th>STARTS</th>
                    <th>COMPLETIONS</th>
                    <th>SESSIONS WITH ERRORS</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>Before · 14 days</td>
                    <td>{fmt(m.baseline.sessions)}</td>
                    <td>{fmt(m.baseline.starts)}</td>
                    <td>{fmt(m.baseline.completions)}</td>
                    <td>{fmt(m.baseline.errorSessions)}</td>
                  </tr>
                  <tr>
                    <td>After · {observedDays(m.daysObserved)} days</td>
                    <td>{fmt(m.after.sessions)}</td>
                    <td>{fmt(m.after.starts)}</td>
                    <td>{fmt(m.after.completions)}</td>
                    <td>{fmt(m.after.errorSessions)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p className="muted">
              Sessions are the sample denominators. Compare cautiously when
              periods or sample sizes differ.
            </p>
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
  origin = origin || "YOUR_WORKSPACE_ORIGIN";
  const snippet = game
    ? `<script src="${origin}/sdk.js"></script>\n<script>\n  GameMarketing.init({ endpoint: "${origin}", sdkKey: "${game.sdkKey}", consent: false });\n  // After the player opts in:\n  GameMarketing.setConsent(true);\n  // On a game event:\n  GameMarketing.track("round_start");\n</script>`
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
              Add a public web game URL. Check the extracted title and artwork.
              A URL alone does not provide player analytics. For a controlled
              first run, add this workspace’s /fixture/index.html URL and select
              fixture mode.
            </p>
          </div>
        </div>
        <div className="help-step">
          <span>↗</span>
          <div>
            <h3>Configure Google sign-in</h3>
            <p>
              Create a Google OAuth web application and register{" "}
              <code>{origin}/api/auth/callback/google</code> as an authorized
              redirect URI. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in the
              server environment, and set APP_URL to the public workspace
              origin. Restart or redeploy after changing environment variables.
            </p>
          </div>
        </div>
        <div className="help-step">
          <span>02</span>
          <div>
            <h3>Install the SDK</h3>
            <p>
              Add the SDK to your game and configure the approved origin. Enable
              tracking only after player consent. Instrument visits, load,
              actions, round starts and completions, retries, progression,
              errors and exits.
            </p>
            {game ? (
              <>
                <p>
                  <strong>Selected game:</strong> {game.title}
                </p>
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
            <p>Player capture is off by default. Review a unique origin-clean canvas and add privacy masks before enabling it. Ask for recording consent separately from analytics consent; call <code>await GameMarketing.startCapture(&#123;consent:true&#125;)</code> only after both are granted. Stop with <code>await GameMarketing.stopCapture()</code>, or discard with <code>await GameMarketing.stopCapture(&#123;discard:true&#125;)</code>. Analytics withdrawal also discards capture.</p>
            <p>Capture is sampled and limited to 30 seconds, 5 fps, 960 × 540, and 3 MiB. It contains the canvas only, no audio or DOM. Inspect private footage in Sessions; it is separate from agent recordings and content clips.</p>
          </div>
        </div>
        <div className="help-step">
          <span>03</span>
          <div>
            <h3>Connect providers and worker</h3>
            <p>
              Add Jev for gameplay decisions and Anthropic for drafts and
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
