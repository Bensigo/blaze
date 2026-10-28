export type Channel = "x" | "youtube" | "instagram" | "tiktok";
export type Provider =
  | "jev"
  | "anthropic"
  | "x"
  | "reddit"
  | "brave"
  | "search_console"
  | Channel;
export interface Game {
  id: string;
  title: string;
  url: string;
  description: string;
  image: string;
  genre: string;
  sdkKey: string;
  origins: string[];
  createdAt: string;
  dailyEnabled: boolean;
  competitors: string[];
  metadataStatus?: string;
  networkPolicy?: { resourceOrigins: string[]; webSocketOrigins: string[] };
  capture?: CaptureConfig;
}
export interface CaptureConfig {
  enabled: boolean;
  canvasSelector: string;
  surfaceReviewed: boolean;
  sampleRate: number;
  maxDurationSeconds: number;
  retentionDays: number;
  maxCapturesPerDay: number;
  masks: { x: number; y: number; width: number; height: number }[];
}
export interface SessionCapture {
  id: string;
  gameId: string;
  sessionId: string;
  playerId: string;
  status:
    | "pending"
    | "ready"
    | "failed"
    | "unsupported"
    | "cancelled"
    | "expired"
    | "not_sampled"
    | "quota_reached";
  createdAt: string;
  expiresAt: string;
  completedAt?: string;
  durationSeconds?: number;
  width?: number;
  height?: number;
  fps?: number;
  size?: number;
  contentType?: string;
  videoUrl?: string;
  reason?: string;
  cleanupPending?: boolean;
}
export interface Recording {
  id: string;
  gameId: string;
  title: string;
  status: "queued" | "recording" | "ready" | "failed";
  mode: "jev" | "fixture";
  createdAt: string;
  duration?: number;
  videoUrl?: string;
  screenshotUrl?: string;
  observations?: {
    at: number;
    text: string;
    type: "observation" | "hypothesis" | "error";
    screenshotUrl?: string;
  }[];
  error?: string;
  actions?: unknown[];
  workerId?: string;
  heartbeatAt?: string;
  sessionId?: string;
}
export interface Clip {
  id: string;
  gameId: string;
  recordingId: string;
  title: string;
  start: number;
  end: number;
  layout: "landscape" | "portrait" | "square";
  status: "queued" | "ready" | "failed";
  videoUrl?: string;
  createdAt: string;
  error?: string;
}
export interface Post {
  id: string;
  gameId: string;
  clipId?: string;
  channel: Channel;
  text: string;
  accountId: string;
  status:
    | "draft"
    | "review"
    | "approved"
    | "scheduled"
    | "uploading"
    | "processing"
    | "published"
    | "failed";
  scheduledAt?: string;
  createdAt: string;
  approvedAt?: string;
  approvedBy?: string;
  approvedHash?: string;
  providerId?: string;
  publicationUrl?: string;
  error?: string;
  campaignId: string;
  trackingUrl?: string;
  tiktokConsent?: {
    consent: true;
    privacy: string;
    disableComment: boolean;
    disableDuet: boolean;
    disableStitch: boolean;
  };
}
export interface Connection {
  id: string;
  provider: string;
  label: string;
  accountId?: string;
  connected: boolean;
  checkedAt?: string;
  details?: string;
  model?: string;
}
export interface Finding {
  id: string;
  gameId: string;
  title: string;
  detail: string;
  type: "observation" | "hypothesis" | "opportunity";
  priority: "high" | "medium" | "low";
  evidence: {
    label: string;
    url?: string;
    recordingId?: string;
    at?: number;
  }[];
  status: "open" | "in_progress" | "resolved";
  createdAt: string;
  metric?: string;
  baseline?: number;
  resolvedAt?: string;
}
export interface ResearchRun {
  id: string;
  gameId: string;
  status: "running" | "complete" | "partial" | "failed";
  startedAt: string;
  finishedAt?: string;
  findings: string[];
  coverage: { source: string; status: string; detail: string }[];
  error?: string;
}
export interface Measurement {
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
}
export interface SessionSummary {
  id: string;
  gameId: string;
  playerId: string;
  kind: "human" | "agent";
  country: string;
  device: string;
  source: string;
  campaign: string;
  startedAt: string;
  lastAt: string;
  events: number;
  completed: boolean;
  lastStep: string;
  errors: number;
  duration: number;
  captureStatus?: SessionCapture["status"];
  captureId?: string;
}
export interface Analytics {
  sessions: number;
  players: number;
  starts: number;
  completions: number;
  replays: number;
  returns: number;
  errorSessions: number;
  firstActions: number;
  lastEventAt: string | null;
  trend: {
    date: string;
    visits: number;
    starts: number;
    completions: number;
  }[];
  funnel: { name: string; count: number }[];
  countries: { name: string; count: number }[];
  sources: { name: string; count: number }[];
  devices: { name: string; count: number }[];
  dropoffs: { name: string; count: number }[];
  retention: {
    date: string;
    players: number;
    eligible: number;
    returned: number;
    rate: number | null;
  }[];
  campaigns: {
    name: string;
    visits: number;
    starts: number;
    completions: number;
    returns: number;
  }[];
  sessionsList: SessionSummary[];
  heatmap: { x: number; y: number; count: number; gameId: string }[];
  syntheticSessions: number;
}
export interface WorkspaceSnapshot {
  user: { name: string; email: string } | null;
  workspace: { id: string; name: string };
  demo: boolean;
  games: Game[];
  recordings: Recording[];
  clips: Clip[];
  posts: Post[];
  connections: Connection[];
  findings: Finding[];
  runs: ResearchRun[];
  measurements?: Measurement[];
  analytics: Analytics;
  system: {
    database: boolean;
    google: boolean;
    storage: boolean;
    worker: boolean;
    lastWorkerAt?: string;
    dailySchedule: string;
    publishingEnabled: boolean;
  };
  error?: string;
}
export interface TelemetryEvent {
  id: string;
  name: string;
  gameId: string;
  sessionId: string;
  playerId: string;
  timestamp: string;
  properties: Record<string, unknown>;
  page: string;
  referrer: string;
  campaign?: string;
  source?: string;
  device?: string;
  kind: "human" | "agent";
}
export interface ActionRequest {
  action: string;
  [key: string]: unknown;
}
export interface ProviderSecret {
  token: string;
  accountId?: string;
  refreshToken?: string;
  expiresAt?: number;
  model?: string;
  [key: string]: unknown;
}
