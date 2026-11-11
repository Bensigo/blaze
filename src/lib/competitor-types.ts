export const competitorCountries = {
  US: "United States",
  GB: "United Kingdom",
  NG: "Nigeria",
  AE: "United Arab Emirates",
  CA: "Canada",
  AU: "Australia",
  IN: "India",
} as const;

export type CompetitorPlatform = "web" | "ios" | "android";
export const competitorPlatforms: Record<CompetitorPlatform, string> = {
  web: "Web",
  ios: "App Store",
  android: "Google Play",
};

export type CompetitorTarget = {
  id: string;
  title: string;
  url: string;
  platform: CompetitorPlatform;
  appId?: string;
  owned?: boolean;
};

export type CompetitorMarket = {
  keyword: string;
  country: string;
  device: "desktop" | "mobile";
};

export type EvidenceStatus = "ok" | "unavailable" | "skipped";
export type CompetitorEvidence = {
  web: Record<string, { rank: number | null; estimatedVisits: number | null }>;
  stores: Record<string, {
    rankedKeywords: number;
    topTenKeywords: number;
    estimatedSearchVolume: number | null;
  }>;
  sources: { search: EvidenceStatus; traffic: EvidenceStatus; ios: EvidenceStatus; android: EvidenceStatus };
};

export const competitorLimit = 10;
export type CompetitorEntry = { title: string; url: string; owned?: boolean };
export type CompetitorWatchlist = { id: string; revision: number; entries: CompetitorTarget[] };
export type CompetitorReport = {
  observedAt: string;
  targetsKey: string;
  market: CompetitorMarket;
  evidence: CompetitorEvidence;
};
export type CompetitorView = {
  watchlist: CompetitorWatchlist;
  targets: CompetitorTarget[];
  providerConnected: boolean;
  latest: CompetitorReport | null;
  previous: CompetitorReport | null;
  stale: boolean;
};
