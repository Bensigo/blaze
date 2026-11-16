export type PortalId = "crazygames" | "poki" | "itch" | "gamedistribution";
export type PortalGapView = {
  rows: {
    id: PortalId; name: string; searchDomain: string; publishUrl: string;
    own: { status: "unknown" | "listed" | "not_listed"; url?: string; checkedAt?: string; source?: "watchlist" | "manual" };
    rivals: { targetId: string; title: string; url: string; source: "watchlist" | "manual" }[];
  }[];
  targets: { id: string; title: string }[];
};
