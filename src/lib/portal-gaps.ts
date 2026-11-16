import { z } from "zod";
import { comparePut, get, query } from "./db";
import { HttpError } from "./http-error";
import type { CompetitorTarget, CompetitorWatchlist } from "./competitor-types";
import type { Game } from "./types";
import type { PortalGapView, PortalId } from "./portal-gap-types";

const portals: Pick<PortalGapView["rows"][number], "id" | "name" | "searchDomain" | "publishUrl">[] = [
  { id: "crazygames", name: "CrazyGames", searchDomain: "crazygames.com", publishUrl: "https://developer.crazygames.com/" },
  { id: "poki", name: "Poki", searchDomain: "poki.com", publishUrl: "https://developers.poki.com/" },
  { id: "itch", name: "itch.io", searchDomain: "itch.io", publishUrl: "https://itch.io/game/new" },
  { id: "gamedistribution", name: "GameDistribution", searchDomain: "gamedistribution.com", publishUrl: "https://gamedistribution.com/developers/" },
];
const portalId = z.enum(["crazygames", "poki", "itch", "gamedistribution"]);
export const portalGapInput = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("save_rival"), portalId, targetId: z.string().regex(/^[a-f0-9]{32}$/), url: z.string().trim().min(1).max(2000) }),
  z.strictObject({ action: z.literal("remove_rival"), portalId, targetId: z.string().regex(/^[a-f0-9]{32}$/) }),
  z.strictObject({ action: z.literal("set_own"), portalId, status: z.enum(["unknown", "listed", "not_listed"]), url: z.string().trim().min(1).max(2000).optional() }).refine(v => v.status === "listed" ? !!v.url : !v.url),
]);
type Own = PortalGapView["rows"][number]["own"];
type Saved = { id: string; own: Partial<Record<PortalId, Own>>; rivals: { portalId: PortalId; targetId: string; url: string | null }[] };

// Only canonical individual listing shapes are evidence; no request is made to these URLs.
export function canonicalPortalUrl(raw: string): { portalId: PortalId; url: string } | undefined {
  let u: URL;
  try { u = new URL(raw); } catch { return; }
  if (!["http:", "https:"].includes(u.protocol) || u.username || u.password || u.port) return;
  const host = u.hostname.toLowerCase().replace(/\.$/, "");
  const path = u.pathname.replace(/\/$/, "");
  let id: PortalId | undefined; let canonicalHost = host; let canonicalPath = path;
  const slug = "[a-z0-9][a-z0-9_-]*";
  if (["crazygames.com", "www.crazygames.com"].includes(host) && new RegExp(`^/game/${slug}$`, "i").test(path)) { id = "crazygames"; canonicalHost = "www.crazygames.com"; }
  else if (["poki.com", "www.poki.com"].includes(host) && new RegExp(`^/[a-z]{2}(?:-[a-z]{2})?/g/${slug}$`, "i").test(path)) { id = "poki"; canonicalHost = "poki.com"; canonicalPath = path.replace(/^\/[^/]+\/g\//i, "/en/g/"); }
  else if (["gamedistribution.com", "www.gamedistribution.com"].includes(host) && new RegExp(`^/games/${slug}$`, "i").test(path)) { id = "gamedistribution"; canonicalHost = "gamedistribution.com"; }
  else if (/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.itch\.io$/i.test(host) && !/^(?:www|itch|api|static|html|img|cdn|support|help|status|blog|dashboard|admin)\.itch\.io$/i.test(host) && new RegExp(`^/${slug}$`, "i").test(path) && !/^\/(?:dashboard|games|profile|feed|community|settings|collections|my-collections|game|users|login|register|search|uploads|jam|jams)$/i.test(path)) id = "itch";
  if (!id) return;
  return { portalId: id, url: `https://${canonicalHost}${canonicalPath}` };
}
async function watchlist(workspace: string, game: Game) { return (await get<CompetitorWatchlist>(workspace, "competitor_watchlist", game.id))?.entries || []; }
function ownListings(game: Game, entries: CompetitorTarget[]) {
  const urls = [game.url, ...entries.filter(entry => entry.owned && entry.platform === "web").map(entry => entry.url)];
  return urls.flatMap(url => canonicalPortalUrl(url) ?? []);
}
function build(game: Game, entries: CompetitorTarget[], saved?: Saved): PortalGapView {
  const targets = entries.filter(e => !e.owned && e.platform === "web");
  const ownURLs = ownListings(game, entries);
  return { targets: targets.map(({ id, title }) => ({ id, title })), rows: portals.map(portal => {
    const inferredOwn = ownURLs.find(x => x.portalId === portal.id);
    const manualOwn = saved?.own[portal.id];
    const own: Own = manualOwn?.status === "listed" ? manualOwn : inferredOwn
      ? { status: "listed", url: inferredOwn.url, source: "watchlist" }
      : manualOwn ?? { status: "unknown" };
    const seen = new Set<string>();
    const rivals = targets.flatMap(target => {
      const manual = saved?.rivals.find(x => x.portalId === portal.id && x.targetId === target.id);
      if (manual && manual.url === null) return [];
      const inferred = canonicalPortalUrl(target.url);
      const url = manual?.url || (inferred?.portalId === portal.id ? inferred.url : undefined);
      if (!url || seen.has(url) || url === own.url || ownURLs.some(x => x.url === url)) return [];
      seen.add(url);
      return [{ targetId: target.id, title: target.title, url, source: manual ? "manual" as const : "watchlist" as const }];
    });
    return { ...portal, own, rivals };
  }) };
}
export async function readPortalGaps(workspace: string, game: Game) {
  const [entries, saved] = await Promise.all([watchlist(workspace, game), get<Saved>(workspace, "portal_gaps", game.id)]);
  return build(game, entries, saved);
}
export async function savePortalGaps(workspace: string, game: Game, input: z.infer<typeof portalGapInput>) {
  const entries = await watchlist(workspace, game);
  if (input.action !== "set_own" && !entries.some(e => e.id === input.targetId && !e.owned && e.platform === "web")) throw new HttpError(400, "Choose a saved web competitor.");
  const current = await get<Saved>(workspace, "portal_gaps", game.id);
  const next: Saved = { id: game.id, own: { ...current?.own }, rivals: (current?.rivals || []).filter(r => entries.some(e => e.id === r.targetId && !e.owned && e.platform === "web")) };
  if (input.action === "set_own") {
    const listing = input.url && canonicalPortalUrl(input.url);
    if (input.status === "listed" && (!listing || listing.portalId !== input.portalId)) throw new HttpError(400, "Enter an individual listing URL for this portal.");
    if (input.status === "not_listed" && ownListings(game, entries).some(listing => listing.portalId === input.portalId))
      throw new HttpError(409, "Your game or watchlist already has a listing for this portal. Update that link first.");
    if (input.status === "unknown") delete next.own[input.portalId];
    else next.own[input.portalId] = { status: input.status, ...(listing ? { url: listing.url } : {}), checkedAt: new Date().toISOString(), source: "manual" };
  } else {
    next.rivals = next.rivals.filter(r => r.portalId !== input.portalId || r.targetId !== input.targetId);
    if (input.action === "save_rival") {
      const listing = canonicalPortalUrl(input.url);
      if (!listing || listing.portalId !== input.portalId) throw new HttpError(400, "Enter an individual listing URL for this portal.");
      if (ownListings(game, entries).some(own => own.url === listing.url) || next.own[input.portalId]?.url === listing.url)
        throw new HttpError(400, "This URL is already saved as your own listing.");
      const row = build(game, entries, next).rows.find(row => row.id === input.portalId);
      if (row?.rivals.some(rival => rival.url === listing.url && rival.targetId !== input.targetId))
        throw new HttpError(409, "This URL is already saved for another competitor on this portal.");
      next.rivals.push({ portalId: input.portalId, targetId: input.targetId, url: listing.url });
    } else next.rivals.push({ portalId: input.portalId, targetId: input.targetId, url: null });
  }
  const saved = current ? await comparePut(workspace, "portal_gaps", current, next) : (await query("INSERT INTO records(workspace_id, kind, id, body) VALUES($1,$2,$3,$4::jsonb) ON CONFLICT DO NOTHING RETURNING id", [workspace, "portal_gaps", game.id, JSON.stringify(next)])).length > 0;
  if (!saved) throw new HttpError(409, "Portal evidence changed. Reload and retry.");
  return readPortalGaps(workspace, game);
}
