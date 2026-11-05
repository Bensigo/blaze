export type Channel = "x" | "youtube" | "instagram" | "tiktok";
export type Provider =
  | "jev"
  | "anthropic"
  | "openrouter"
  | "x"
  | "x_feedback"
  | "reddit"
  | "brave"
  | "search_console"
  | Channel;
export interface Game {
  telemetry?: {humanEvents:number;lastEventAt:string|null};
  foreverCatalogue?: {state:'listed'|'retired';slug:string;checkedAt:string};
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
  sourceUrlRevision?: string;
  metadataStatus?: string;
  manifestSource?: { url: string; observedAt: string; sha256: string; formatVersion: 1 };
  networkPolicy?: { resourceOrigins: string[]; webSocketOrigins: string[]; frameUrls?: string[] };
  capture?: CaptureConfig;
}
export interface CaptureConfig {
  enabled: boolean;
  canvasSelector: string;
  surfaceReviewed: boolean;
  sampleRate: number;
  maxDurationSeconds: number;
  maxSegments?: number;
  retentionDays: number;
  maxCapturesPerDay: number;
  masks: { x: number; y: number; width: number; height: number }[];
}
export interface SessionCapture {
  id: string;
  gameId: string;
  sessionId: string;
  segment?: number;
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
  recordedAt?: string;
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
  paidApprovalId?: string;
  targetProvenance?: 'controlled_lab';
  maxActions?: number;
  maxDurationSeconds?: number;
  jevSelection?: { connectionId: string; model: string; settingsRevision: string; credentialVersion: string };
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
  deliveryMethod?: "manual" | "native";
  timeZone?: string;
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
  manualExportedAt?: string;
  manualPublishedAt?: string;
  manualConfirmedAt?: string;
  manualPublishedBy?: string;
  manualPublicationUrl?: string;
  recommendation?: { confidence: "low" | "medium"; reason: string; time: string };
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
  credentialVersion?: string;
  id: string;
  provider: string;
  label: string;
  accountId?: string;
  connected: boolean;
  checkedAt?: string;
  details?: string;
  model?: string;
  authMethod?: "oauth" | "manual";
  accountName?: string;
  scopes?: string[];
  expiresAt?: string;
  requiresReconnect?: boolean;
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
  status: "open" | "in_progress" | "deferred" | "dismissed" | "resolved";
  deferredUntil?: string;
  decisionNote?: string;
  updatedAt?: string;
  action?: { suggestion: string; reason: string; impactHypothesis: string; effort: "small" | "medium" | "large" | "unknown"; whyNow: string; checkMetric: string; observedAt?: string };
  createdAt: string;
  metric?: string;
  baseline?: number;
  resolvedAt?: string;
}
export interface ResearchRun {
  ai?: { provider?: string; model?: string; phase: "configuration" | "history" | "inference" | "validation" | "complete"; status: "not_requested" | "preparing" | "running" | "succeeded" | "failed"; dispatches: number; responses: number; startedAt?: string; lastAttemptAt?: string; succeededAt?: string; errorCode?: string; httpStatus?: number };
  id: string;
  gameId: string;
  status: "running" | "complete" | "partial" | "failed";
  startedAt: string;
  finishedAt?: string;
  findings: string[];
  coverage: { source: string; status: string; detail: string }[];
  error?: string;
}
export interface MeasurementWindow { start: string; end: string }
export interface MeasurementRelease { version: string; description: string; evidenceUrl: string; effectiveAt: string }
export interface MeasurementMetrics {
  players: number; sessions: number; starts: number; completions: number; errorSessions: number;
  activePlay: { totalSeconds: number | null; measuredSessions: number; eligibleSessions: number };
  completion: { numerator: number; denominator: number; rate: number | null };
  conversion: { numerator: number; denominator: number; rate: number | null };
  returningPlayers: number;
  d1: { cohortPlayers: number; eligible: number; returned: number; rate: number | null };
  sources: { name: string; count: number }[]; devices: { name: string; count: number }[];
}
export interface MeasurementOutcome {
  baseline: MeasurementMetrics; followup: MeasurementMetrics;
  observedFollowupEnd: string | null; mature: boolean; releaseEvidence: "owner_reported"; caveats: string[]; nextAction: string;
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
  release?: MeasurementRelease;
  baselineWindow?: MeasurementWindow;
  followupWindow?: MeasurementWindow;
  releaseContextStatus?: "recorded" | "missing" | "invalid";
  outcome?: MeasurementOutcome;
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
  activePlaySeconds?: number | null;
  captureStatus?: SessionCapture["status"];
  captureId?: string;
}
export interface Analytics {
  audience?: import('./audience').Audience;
  mostPlayedGames?: {gameId:string;browserIds:number;playedSessions:number;roundStarts:number;activeSeconds:number|null;measuredSessions:number}[];
  launch?: { visits: number; exits: number; coverage?: { sessions: number; visit: number; loaded: number; roundStart: number; firstAction: number; roundComplete: number; exit: number }; conversion: { source: string; campaign: string; visits: number; starts: number; meaningful: number; activeMeasured: number }[]; conversionTotal: number };
  windowEnd?: string;
  activePlay?: { totalSeconds: number | null; averageSeconds: number | null; medianSeconds: number | null; measuredSessions: number; eligibleSessions: number };
  loadedSessions?: number;
  progressionSessions?: number;
  sessionPage?: { limit: number; total: number; nextCursor?: string };
  coverage?: Record<string, { total: number; shown: number }>;
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
  heatmap: { x: number; y: number; bx: number; by: number; count: number; gameId: string; surface: "game" | "viewport"; screen: string; device: string }[];
  syntheticSessions: number;
}
export interface DailyDispatchStatus {
  day: string;
  state: "queued" | "running" | "completed" | "partial" | "failed";
  total: number; completed: number; partial: number; failed: number; remaining: number;
  updatedAt: string; lastRunAt?: string; error?: string;
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
    databaseUsage?: { bytes: number | null; limitBytes: number | null; paused: boolean; measuredAt: string | null; retentionDays: null; reason?: string };
    google: boolean;
    storage: boolean;
    worker: boolean;
    lastWorkerAt?: string;
    dailySchedule: string;
    dailyDispatch?: DailyDispatchStatus;
    publishingEnabled: boolean;
    social?: { provider: string; configured: boolean; setup: string; callbackUrl: string }[];
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
