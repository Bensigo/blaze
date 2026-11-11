import { isIP } from "node:net";
import { z } from "zod";
import { comparePut, get, query, rateLimit } from "./db";
import { HttpError } from "./http-error";
import { collectCompetitorEvidence } from "./integrations/dataforseo-competitors";
import { hash } from "./security";
import type { Game } from "./types";
import {
  competitorCountries, competitorLimit,
  type CompetitorEntry, type CompetitorMarket, type CompetitorPlatform,
  type CompetitorReport, type CompetitorTarget, type CompetitorView, type CompetitorWatchlist,
} from "./competitor-types";

const WATCHLIST = "competitor_watchlist";
const REPORT = "competitor_report";
type SavedReports = { id: string; latest: CompetitorReport; previous: CompetitorReport | null };

const entrySchema = z.strictObject({
  title: z.string().trim().min(1).max(120),
  url: z.string().trim().min(1).max(2000),
  owned: z.boolean().optional(),
});
export const watchlistInput = z.strictObject({
  revision: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER - 1),
  entries: z.array(entrySchema).max(competitorLimit + 3),
});
export const marketInput = z.strictObject({
  country: z.enum(competitorCountriesKeys()),
  device: z.enum(["desktop", "mobile"]),
  // Plain-language keywords only. Provider search operators can carry extra charges.
  keyword: z.string().trim().max(80).regex(/^(?:[\p{L}\p{M}\p{N}][\p{L}\p{M}\p{N} '’&-]*)?$/u),
});

function competitorCountriesKeys() {
  return Object.keys(competitorCountries) as (keyof typeof competitorCountries)[];
}

export function competitorTarget(entry: CompetitorEntry): CompetitorTarget {
  let url: URL;
  try { url = new URL(entry.url); } catch { throw new HttpError(400, "Enter a full game or store URL."); }
  const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.port ||
      !hostname.includes(".") || isIP(hostname) || /\.(?:local|localhost|internal|test|invalid)$/.test(hostname))
    throw new HttpError(400, "Use a public game or store URL on a standard port.");
  let platform: CompetitorPlatform = "web";
  let appId: string | undefined;
  if (hostname === "apps.apple.com" || hostname === "itunes.apple.com") {
    platform = "ios";
    appId = url.pathname.match(/^\/(?:[a-z]{2}\/)?app\/(?:[^/]+\/)?id(\d{5,20})\/?$/i)?.[1];
    if (!appId) throw new HttpError(400, "Use a link to an individual App Store game.");
    url = new URL("https://apps.apple.com/app/id" + appId);
  } else if (hostname === "play.google.com") {
    platform = "android";
    appId = url.searchParams.get("id") ?? undefined;
    if (url.pathname.replace(/\/$/, "") !== "/store/apps/details" ||
        url.searchParams.getAll("id").length !== 1 || !appId ||
        appId.length > 160 || !/^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$/i.test(appId))
      throw new HttpError(400, "Use a link to an individual Google Play game.");
    url = new URL("https://play.google.com/store/apps/details?id=" + appId);
  } else {
    for (const name of Array.from(url.searchParams.keys())) {
      if (/^utm_[a-z0-9_]+$/i.test(name) || /^(?:gclid|fbclid)$/i.test(name)) url.searchParams.delete(name);
    }
    if (url.search) throw new HttpError(400, "Use a game page URL without query parameters.");
    url.hash = "";
    url.hostname = hostname;
  }
  return {
    id: hash(platform + ":" + (appId || url.href)).slice(0, 32),
    title: entry.title.trim(),
    platform,
    url: url.href,
    ...(appId ? { appId } : {}),
    ...(entry.owned ? { owned: true } : {}),
  };
}

function primaryTarget(game: Pick<Game, "title" | "url">) {
  try { return competitorTarget({ title: game.title, url: game.url, owned: true }); }
  catch { return undefined; }
}

function targetsFor(game: Game, watchlist: CompetitorWatchlist) {
  const primary = primaryTarget(game);
  const entries = watchlist.entries.filter(entry =>
    entry.id !== primary?.id && !(entry.owned && entry.platform === primary?.platform));
  return [...(primary ? [primary] : []), ...entries];
}

function targetsKey(targets: CompetitorTarget[]) {
  return hash(targets.map(t => t.id + (t.owned ? ":own" : ":peer")).sort().join(","));
}

function credentialsFor(workspace: string) {
  // Explicit opt-in is required even when the server has provider credentials.
  const allowed = (process.env.BLAZE_COMPETITOR_WORKSPACE_IDS || "").split(",").map(id => id.trim()).filter(Boolean);
  const login = process.env.DATAFORSEO_LOGIN?.trim();
  const password = process.env.DATAFORSEO_PASSWORD;
  return login && password && allowed.includes(workspace) ? { login, password } : null;
}

function readWatchlist(workspace: string, gameId: string) {
  return get<CompetitorWatchlist>(workspace, WATCHLIST, gameId);
}

function emptyWatchlist(gameId: string): CompetitorWatchlist {
  return { id: gameId, revision: 0, entries: [] };
}

export async function readCompetitors(workspace: string, game: Game): Promise<CompetitorView> {
  const providerConnected = !!credentialsFor(workspace);
  const [saved, reports] = await Promise.all([
    readWatchlist(workspace, game.id),
    providerConnected ? get<SavedReports>(workspace, REPORT, game.id) : undefined,
  ]);
  const watchlist = saved || emptyWatchlist(game.id);
  const targets = targetsFor(game, watchlist);
  return {
    watchlist, targets, providerConnected,
    latest: reports?.latest || null,
    previous: reports?.previous || null,
    stale: !!reports && reports.latest.targetsKey !== targetsKey(targets),
  };
}

export async function saveCompetitors(workspace: string, game: Game, input: z.infer<typeof watchlistInput>) {
  const current = await readWatchlist(workspace, game.id);
  if ((current?.revision ?? 0) !== input.revision)
    throw new HttpError(409, "The watchlist changed. Reload it before editing.");
  const entries = input.entries.map(competitorTarget);
  if (entries.filter(entry => !entry.owned).length > competitorLimit)
    throw new HttpError(400, "Track up to 10 competitors per game.");
  const primary = primaryTarget(game);
  const ids = new Set(primary ? [primary.id] : []);
  const ownPlatforms = new Set(primary ? [primary.platform] : []);
  for (const target of entries) {
    if (ids.has(target.id)) throw new HttpError(400, "This game or listing is already on the watchlist.");
    if (target.owned && ownPlatforms.has(target.platform)) throw new HttpError(400, "Add only one of your own listings per platform.");
    ids.add(target.id);
    if (target.owned) ownPlatforms.add(target.platform);
  }
  const next = { id: game.id, revision: input.revision + 1, entries };
  const saved = current
    ? await comparePut(workspace, WATCHLIST, current, next)
    : (await query(
      "INSERT INTO records(workspace_id, kind, id, body) VALUES($1,$2,$3,$4::jsonb) ON CONFLICT DO NOTHING RETURNING id",
      [workspace, WATCHLIST, game.id, JSON.stringify(next)],
    )).length > 0;
  if (!saved) throw new HttpError(409, "The watchlist changed. Reload it before editing.");
  return readCompetitors(workspace, game);
}

function comparable(previous: CompetitorReport | undefined, current: CompetitorReport) {
  return previous && previous.targetsKey === current.targetsKey &&
    previous.market.country === current.market.country &&
    previous.market.keyword === current.market.keyword &&
    previous.market.device === current.market.device;
}

export async function refreshCompetitors(workspace: string, game: Game, market: CompetitorMarket) {
  const credentials = credentialsFor(workspace);
  if (!credentials) throw new HttpError(409, "DataForSEO is not connected for this workspace.");
  const view = await readCompetitors(workspace, game);
  if (!view.targets.some(target => !target.owned))
    throw new HttpError(400, "Add a competitor before refreshing.");
  if (!await rateLimit("competitor-refresh:" + workspace, 1) ||
      !await rateLimit("competitor-day:" + workspace, 8, 86_400) ||
      !await rateLimit("competitor-instance-day", 24, 86_400))
    throw new HttpError(429, "Refresh limit reached. Try again later.");
  const observedAt = new Date().toISOString();
  const evidence = await collectCompetitorEvidence(view.targets, market, credentials);
  if (!Object.values(evidence.sources).includes("ok"))
    throw new HttpError(502, "DataForSEO could not refresh this report. Saved results are unchanged.");
  const latest = { observedAt, targetsKey: targetsKey(view.targets), market, evidence };
  const stored = await get<SavedReports>(workspace, REPORT, game.id);
  const previous = comparable(stored?.latest, latest) ? stored!.latest : null;
  const next = { id: game.id, latest, previous };
  // A slower earlier refresh must not overwrite a newer report.
  if (!stored || stored.latest.observedAt < observedAt) {
    if (stored) await comparePut(workspace, REPORT, stored, next);
    else await query(
      "INSERT INTO records(workspace_id, kind, id, body) VALUES($1,$2,$3,$4::jsonb) ON CONFLICT DO NOTHING",
      [workspace, REPORT, game.id, JSON.stringify(next)],
    );
  }
  const active = await get<Game>(workspace, "game", game.id);
  if (!active) throw new HttpError(404, "Game not found.");
  return readCompetitors(workspace, active);
}
