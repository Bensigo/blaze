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
  sessionId?: string; error?: string; videoUrl?: string; clipId?: string;
  plannedDate?: string; planningTimeZone?: "Asia/Dubai";
  usage?: { listCostCents?: string; inputTokens?: number; outputTokens?: number; status: "unavailable" | "reported_unsettled" | "settled" };
};
export type IdeaSchedule = {
  id: "default"; countPerGame: 2 | 3; timeZone: "Asia/Dubai";
  localTime: string | null; enabled: boolean; maxOutputTokensPerGame: number;
};
export type StudioSnapshot = {
  ideas: ContentIdea[]; productions: VideoProduction[]; schedule: IdeaSchedule;
  readiness: { ready: boolean; reasons: string[]; provider: "anthropic_managed_agents"; connectionLabel?: string };
};
