import { createHash } from "node:crypto";
import { get, put, query } from "./db";
import { extractPage } from "./integrations/research";
import { fetchPublic, type PublicResponse } from "./integrations/safe-fetch";
import type { Game, ResearchRun } from "./types";

export type DiscoveryGroup = "technical" | "answers" | "search" | "citations";
export type DiscoveryCheck = { group: DiscoveryGroup; label: string; status: "passed" | "attention" | "unmeasured"; detail: string; url?: string; priority?: number; fix?: string };
export type DiscoveryReview = { id: string; gameId: string; observedAt: string; sourceUrl: string; sourceIdentity?: string; source: "public audit" | "research baseline"; stale: boolean; checks: DiscoveryCheck[] };
type Fetcher = (url: string) => Promise<PublicResponse>;
const safeUrl = (url: string) => { const u = new URL(url); if (!["http:", "https:"].includes(u.protocol)) throw new Error("Unsupported URL"); u.username = ""; u.password = ""; u.search = ""; u.hash = ""; return u.href; };
const identity = (url: string) => { const u = new URL(url); if (!["http:", "https:"].includes(u.protocol)) throw new Error("Unsupported URL"); u.hash = ""; return createHash("sha256").update(u.href).digest("hex"); };
const unmeasured: DiscoveryCheck[] = [
  { group: "search", label: "Google Search Console", status: "unmeasured", detail: "Search visibility and indexing are not measured by this public-page review. Connect Search Console and run research for authorized observations." },
  { group: "search", label: "Keyword demand", status: "unmeasured", detail: "Keyword ideas are guesses until supported by search data; no demand or ranking was measured." },
  { group: "citations", label: "AI citations", status: "unmeasured", detail: "AI citation tracking is not implemented." },
];
export async function auditDiscovery(game: Game, fetcher: Fetcher = fetchPublic): Promise<DiscoveryReview> {
  const observedAt = new Date().toISOString(); const checks: DiscoveryCheck[] = []; const pageUrl = safeUrl(game.url);
  try {
    if (new URL(game.url).search) throw new Error("Query-specific page was not fetched");
    const res = await fetcher(pageUrl); const source = safeUrl(res.url);
    if (res.status < 200 || res.status >= 300) throw new Error(`HTTP ${res.status}`);
    if (!/html/i.test(res.contentType)) throw new Error("Response is not HTML");
    const facts = extractPage(source, res.body, res.xRobotsTag);
    for (const [label, value, fix] of [["Page title", facts.title, "Add a descriptive title to the public game page."], ["Meta description", facts.description, "Add a concise description of the game to its meta description."], ["Main heading", facts.heading, "Add a visible H1 identifying the game."], ["Canonical link", facts.canonical, "Add and verify a canonical link for the intended public game URL."]] as const) checks.push({ group: "technical", label, status: value ? "passed" : "attention", detail: value ? `${label} is present in static HTML. Its quality and correctness have not been verified.` : `${label} was not found in static HTML.`, url: source, priority: 2, ...(!value ? { fix } : {}) });
    const restricted = /(?:^|[,:;\s])(noindex|none)(?:$|[,:;\s])/i.test(`${facts.robots}; ${facts.xRobots}`);
    checks.push({ group: "technical", label: "Indexing directives", status: restricted ? "attention" : "unmeasured", detail: restricted ? "A noindex or none directive was found in page metadata or response headers." : "No noindex directive found in the fetched page or headers. Effective crawl access and indexing are unmeasured.", url: source, priority: 1, ...(restricted ? { fix: "Review and remove unintended noindex directives for the relevant crawlers." } : {}) });
    for (const [label, pattern, fix] of [["Rules and how to play", /\b(rules|how to play|instructions)\b/i, "Add clear rules or how-to-play steps to the public game page."], ["Controls", /\b(controls|keyboard|tap|click|mouse|arrow keys)\b/i, "Explain the game's controls on the public page."], ["FAQ", /\b(faq|frequently asked questions)\b/i, "Add useful questions and answers about the game where appropriate."]] as const) {
      const found = pattern.test(facts.content);
      checks.push({ group: "answers", label, status: found ? "unmeasured" : "attention", detail: found ? "Related wording appears in static HTML. Accuracy and completeness were not assessed." : "Related wording was not found in static HTML; equivalent wording and client-rendered content were not evaluated.", url: source, priority: 3, ...(!found ? { fix } : {}) });
    }
  } catch (error) {
    const reason = error instanceof Error && /^(HTTP \d+|Response is not HTML|Query-specific page was not fetched)$/.test(error.message) ? error.message : "Safe fetch failed or timed out";
    checks.push({ group: "technical", label: "Public game page", status: "unmeasured", detail: `${reason}. Page metadata and answer content could not be checked.`, url: pageUrl, priority: 1, ...(new URL(game.url).search ? {} : { fix: "Check the registered public URL and make sure it returns accessible HTML." }) });
    checks.push({ group: "answers", label: "Answer content", status: "unmeasured", detail: "The public page could not be inspected." });
  }
  for (const path of ["/robots.txt", "/sitemap.xml"]) {
    const url = new URL(path, pageUrl).href;
    try { const res = await fetcher(url); checks.push({ group: "technical", label: path, status: "unmeasured", detail: `HTTP ${res.status}. Presence or absence alone does not establish crawler access, sitemap coverage or indexing.`, url: safeUrl(res.url) }); }
    catch { checks.push({ group: "technical", label: path, status: "unmeasured", detail: "Safe fetch failed or timed out; this source was not assessed.", url }); }
  }
  return { id: game.id, gameId: game.id, observedAt, sourceUrl: pageUrl, sourceIdentity: identity(game.url), source: "public audit", stale: false, checks: [...checks, ...unmeasured] };
}
export async function readDiscovery(workspace: string, game: Game): Promise<DiscoveryReview | undefined> {
  const cached = await get<DiscoveryReview>(workspace, "discovery_review", game.id);
  if (cached) return { ...cached, stale: cached.sourceIdentity ? cached.sourceIdentity !== identity(game.url) : !!new URL(game.url).search || !cached.sourceUrl || cached.sourceUrl !== safeUrl(game.url) };
  const baseline = await get<{ id: string; url: string; observedAt: string; words: number }>(workspace, "seo_baseline", game.id);
  if (!baseline) return undefined;
  const runs = await query<{ body: ResearchRun }>(`SELECT body FROM records WHERE workspace_id=$1 AND kind='run' AND body->>'gameId'=$2 ORDER BY updated_at DESC LIMIT 50`, [workspace, game.id]);
  const baselineTime = Date.parse(baseline.observedAt);
  const run = runs.map(r => r.body).find(r => Number.isFinite(baselineTime) && Math.abs(Date.parse(r.startedAt) - baselineTime) < 120000);
  const page = !new URL(game.url).search && !new URL(baseline.url).search ? run?.coverage.find(c => c.source === "Game page") : undefined;
  const checks: DiscoveryCheck[] = [{ group: "technical", label: "Cached public page observation", status: "unmeasured", detail: page ? `${page.detail} Observed during the research run; this does not establish indexing.` : `Static HTML baseline: ${baseline.words} estimated words. Detailed source observations are unavailable.`, url: safeUrl(baseline.url) }, { group: "answers", label: "Answer content", status: "unmeasured", detail: "The cached baseline does not establish whether rules, controls or FAQs were present. Refresh for a current public-page review." }, ...unmeasured];
  return { id: game.id, gameId: game.id, observedAt: baseline.observedAt, sourceUrl: safeUrl(baseline.url), source: "research baseline", stale: !!new URL(game.url).search || !!new URL(baseline.url).search || safeUrl(baseline.url) !== safeUrl(game.url), checks };
}
export async function refreshDiscovery(workspace: string, game: Game) { const review = await auditDiscovery(game); return put(workspace, "discovery_review", review); }
