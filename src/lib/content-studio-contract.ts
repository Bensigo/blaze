export type VideoSettings = {
  aspectRatio: "16:9" | "9:16" | "1:1";
  durationSeconds: number;
  captions: "minimal" | "full" | "none";
  music: "quiet_generated" | "none";
  gameAudio: boolean;
  motionGraphics: boolean;
};
export const DEFAULT_VIDEO_SETTINGS: VideoSettings = {
  aspectRatio: "9:16", durationSeconds: 30, captions: "minimal",
  music: "quiet_generated", gameAudio: false, motionGraphics: true,
};
export type ContentIdea = {
  id: string; gameId: string; title: string; hook: string; treatment: string;
  shots: string[]; factKeys: string[]; sourceRevision: string; createdAt: string;
  referenceSetRevision?:string;referenceIds?:string[];rubricRevision?:string;
  origin: "source_outline" | "daily_agent"; fingerprint: string;
};
export type ProductionState = "approved" | "starting" | "running" | "importing" | "cancel_requested" |
  "cancelled" | "needs_reconciliation" | "failed" | "ready";
export type VideoProduction = {
  id: string; gameId: string; ideaId: string; idea: ContentIdea; settings: VideoSettings;
  state: ProductionState; approvedBy: string; approvedAt: string; expiresAt: string;
  approvalHash: string; sourceRevision: string; maxListCostCents: number;
  providerRevision: string; createdAt: string; updatedAt: string;
  credentialRevision: string;
  sourceUrl?: string;
  scriptId?: string; scriptRevision?: string; scriptReviewId?: string; scriptText?: string;
  pilotGrantId?: string;
  sessionId?: string; error?: string; videoUrl?: string; clipId?: string;
  idleObservedAt?: string;
  importStartedAt?: string;
  startedAt?: string; watchdogDeadlineAt?: string; stoppedAt?: string; lastWatchdogAt?: string;
  stopRequest?: { id: string; reason: "owner_cancel" | "runtime_limit"; requestedAt: string; state: "pending_session" | "dispatching" | "requested" | "uncertain" | "confirmed" };
  plannedDate?: string; planningTimeZone?: "Asia/Dubai";
  usage?: { listCostCents?: string; inputTokens?: number; outputTokens?: number; status: "unavailable" | "reported_unsettled" | "settled" };
};
export type IdeaSchedule = {
  id: "default"; countPerGame: 2 | 3; timeZone: "Asia/Dubai";
  localTime: string | null; enabled: boolean; maxOutputTokensPerGame: number;
};
export type StudioSnapshot = {
  sourceFacts?: { gameId:string; sourceRevision:string; facts:{key:string;value:string}[] }[];
  references?:{setId:string;revision:string;rubricRevision:string;selected:{id:string;relevance:string}[]};
  scripts?: { ideaId: string; revision?: string; reviewId?: string; text: string; sourceStale: boolean; contextStale?:boolean;scoreReferenceSetRevision?:string;referenceIds?:string[];referenceSetRevision?:string;rubricRevision?:string; reviewState?: string; staleScore?: import("./content-scripts").ScriptScore; score?: { overall: number; hook: {score:number;explanation:string}; pacing: {score:number;explanation:string}; clarity: {score:number;explanation:string}; shareability: {score:number;explanation:string}; improvements:string[] } }[];
  ideas: ContentIdea[]; productions: VideoProduction[]; schedule: IdeaSchedule;
  pilot?: { operator: boolean; ready: boolean; reasons: string[] };
  readiness: { providerRevision?: string; ready: boolean; reasons: string[]; provider: "anthropic_managed_agents"; connectionLabel?: string };
};

export type PilotGrant = {
  id: string; workspaceId: string; productionId: string; approvedBy: string;
  approvedAt: string; expiresAt: string; reviewHash: string;
  gameId: string; ideaId: string; sourceRevision: string; providerRevision: string;
  credentialRevision: string; connectionId: string; agentId: string;
  agentVersion: number; environmentId: string; settings: VideoSettings;
  maxListCostCents: number; state: "approved" | "consumed" | "revoked";
  consumedAt?: string;
};
export type PilotReview = {
  reviewHash: string; gameId: string; ideaId: string; sourceRevision: string;
  provider: { connectionId: string; agentId: string; agentVersion: number; environmentId: string; revision: string };
  settings: VideoSettings; maxListCostCents: number; ready: boolean; reasons: string[];
};
