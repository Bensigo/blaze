import { createHash } from "node:crypto";
import { get, put, query } from "./db";
import { extractPage } from "./page-facts";
import { fetchPublic, type PublicResponse } from "./integrations/safe-fetch";
import { secretFor } from "./credentials";
import { searchConsoleComparison, searchConsoleQueries, searchConsoleReportUrl, type SearchComparison, type SearchQueryObservation } from "./integrations/search-console";
import type { Game, ResearchRun } from "./types";

export type DiscoveryGroup = "technical" | "answers" | "search" | "citations";
export type DiscoveryCheck = { group: DiscoveryGroup; label: string; status: "passed" | "attention" | "unmeasured"; detail: string; url?: string; priority?: number; fix?: string };
export type DiscoveryReview = { id: string; gameId: string; observedAt: string; sourceUrl: string; sourceIdentity?: string; source: "public audit" | "research baseline"; stale: boolean; checks: DiscoveryCheck[]; searchConsole?: { observedAt: string; comparison: SearchComparison | null; queries: { startDate: string; endDate: string; rows: SearchQueryObservation[]; droppedRows: number } | null; failures: string[] } };
type Fetcher = (url: string) => Promise<PublicResponse>;
const safeUrl = (url: string) => { const u = new URL(url); if (!["http:", "https:"].includes(u.protocol)) throw new Error("Unsupported URL"); u.username = ""; u.password = ""; u.search = ""; u.hash = ""; return u.href; };
const identity = (url: string) => { const u = new URL(url); if (!["http:", "https:"].includes(u.protocol)) throw new Error("Unsupported URL"); u.hash = ""; return createHash("sha256").update(u.href).digest("hex"); };
const unmeasured: DiscoveryCheck[] = [
  { group: "search", label: "Google Search Console", status: "unmeasured", detail: "Search visibility and indexing are not measured by this public-page review. Connect Search Console and refresh this review for authorized observations." },
  { group: "search", label: "Keyword demand", status: "unmeasured", detail: "Keyword ideas are guesses until supported by search data; no demand or ranking was measured." },
  { group: "citations", label: "AI citations", status: "unmeasured", detail: "No provider-connected AI citation tracking is available. Owner-reported Bing evidence can be entered separately." },
];
export async function auditDiscovery(game: Game, fetcher: Fetcher = fetchPublic): Promise<DiscoveryReview> {
  const observedAt = new Date().toISOString(); const checks: DiscoveryCheck[] = []; const pageUrl = safeUrl(game.url);
  const name = game.title?.trim().slice(0, 100) || "the game";
  try {
    if (new URL(game.url).search) throw new Error("Query-specific page was not fetched");
    const res = await fetcher(pageUrl); const source = safeUrl(res.url);
    if (res.status < 200 || res.status >= 300) throw new Error(`HTTP ${res.status}`);
    if (!/html/i.test(res.contentType)) throw new Error("Response is not HTML");
    const facts = extractPage(source, res.body, res.xRobotsTag);
    for (const [label, value, fix] of [["Page title", facts.title, `Add a descriptive title identifying ${name} to its public game page.`], ["Meta description", facts.description, `Describe ${name} and what players do in its meta description.`], ["Main heading", facts.heading, `Add a visible H1 identifying ${name}.`]] as const) checks.push({ group: "technical", label, status: value ? "passed" : "attention", detail: value ? `${label} is present in static HTML. Its quality and correctness have not been verified.` : `${label} was not found in static HTML.`, url: source, priority: 2, ...(!value ? { fix } : {}) });
    let canonicalMatch = false, canonicalValid = false;
    if (facts.canonical) try { const target = new URL(facts.canonical, res.url); canonicalValid = ["http:","https:"].includes(target.protocol) && !target.username && !target.password; canonicalMatch = canonicalValid && !target.hash && target.href === new URL(res.url).href; } catch { /* invalid reference */ }
    const canonicalDetail = !facts.canonical ? "No canonical link found in static HTML." : !canonicalValid ? "Canonical reference is invalid or uses an unsupported scheme." : canonicalMatch ? "Canonical resolves to the fetched URL. This does not establish the search engine's selected canonical." : "Canonical resolves to a different URL than the fetched page. This may be intentional; verify the intended canonical.";
    checks.push({group:"technical",label:"Canonical link",status:canonicalMatch ? "passed" : "attention",detail:canonicalDetail,url:source,priority:2,...(!canonicalMatch ? {fix:`Verify the intended canonical URL for ${name}; use a self-referencing canonical only when this is the preferred page.`} : {})});
    for (const [label, value, fix] of [["Document language",facts.lang,`Set the document language to the language used on ${name}'s page.`],["Viewport hint",facts.viewport,`Add an appropriate viewport declaration and test ${name} on real mobile devices.`],["Open Graph title",facts.ogTitle,`Add an accurate Open Graph title for ${name} if the page is shared.`],["Open Graph description",facts.ogDescription,`Add an accurate Open Graph description for ${name} if the page is shared.`],["Open Graph image",facts.ogImage,`Add a representative Open Graph image for ${name} if the page is shared.`]] as const) checks.push({group:"technical",label,status:value ? "passed" : "attention",detail:value ? `${label} is present in static HTML; its correctness and rendering were not verified.` : `${label} was not found in static HTML.`,url:source,priority:3,...(!value ? {fix} : {})});
    checks.push({group:"technical",label:"JSON-LD syntax",status:facts.jsonLdInvalid ? "attention" : facts.jsonLdCount ? "passed" : "unmeasured",detail:facts.jsonLdCount ? `${facts.jsonLdCount} JSON-LD block(s); ${facts.jsonLdInvalid} could not be parsed as JSON. Syntax validity does not establish schema correctness or rich-result eligibility.` : "No JSON-LD blocks were found. JSON-LD is not required for AI features.",url:source,...(facts.jsonLdInvalid ? {fix:"Fix malformed JSON-LD syntax and validate its contents against the relevant schema."} : {})});
    checks.push({group:"answers",label:"Game structured data",status:facts.gameSchema ? "passed" : "unmeasured",detail:facts.gameSchema ? "A parseable JSON-LD block declares VideoGame or SoftwareApplication. Its properties and accuracy were not validated; this does not guarantee search or AI visibility." : "No parseable JSON-LD block declares VideoGame or SoftwareApplication. Such markup is not required for Google AI features.",url:source});
    const restricted = /(?:^|[,:;\s])(noindex|none)(?:$|[,:;\s])/i.test(`${facts.robots}; ${facts.xRobots}`);
    checks.push({ group: "technical", label: "Indexing directives", status: restricted ? "attention" : "unmeasured", detail: restricted ? "A noindex or none directive was found in page metadata or response headers." : "No noindex directive found in the fetched page or headers. Effective crawl access and indexing are unmeasured.", url: source, priority: 1, ...(restricted ? { fix: "Review and remove unintended noindex directives for the relevant crawlers." } : {}) });
    for (const [label, pattern, fix] of [["Rules and how to play", /\b(rules|how to play|instructions)\b/i, `Explain how to play ${name}, including its objective and rules, on the public game page.`], ["Controls", /\b(controls|keyboard|tap|click|mouse|arrow keys)\b/i, `Explain ${name}’s actual controls for each supported device on the public page.`], ["FAQ", /\b(faq|frequently asked questions)\b/i, `Answer common questions about ${name} where they help players; only publish accurate details.`]] as const) {
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
export async function refreshDiscovery(workspace: string, game: Game) {
  const review = await auditDiscovery(game);
  const secret = await secretFor(workspace, "search_console").catch(() => undefined);
  if (secret?.token && !new URL(game.url).search) {
    try {
      const [comparison, queries] = await Promise.allSettled([searchConsoleComparison(secret, game.url), searchConsoleQueries(secret, game.url)]);
      review.searchConsole = { observedAt: new Date().toISOString(), comparison: comparison.status === "fulfilled" ? comparison.value : null, queries: queries.status === "fulfilled" ? { startDate: queries.value.startDate, endDate: queries.value.endDate, rows: queries.value.rows, droppedRows: queries.value.droppedRows } : null, failures: [...(comparison.status === "rejected" ? ["comparison"] : []), ...(queries.status === "rejected" ? ["queries"] : [])] };
      const checks = review.checks.filter(c => c.label !== "Google Search Console");
      if (comparison.status === "fulfilled") {
        const data = comparison.value;
        const describe = (p: typeof data.recent) => p ? `${p.startDate}–${p.endDate}: ${p.clicks} clicks, ${p.impressions} impressions, ${(p.ctr * 100).toFixed(1)}% CTR, average position ${p.position.toFixed(1)}` : "No available rows";
        checks.push({group:"search",label:"Google Search Console",status:"unmeasured",detail:`Exact-page Web search: recent ${describe(data.recent)}; prior ${describe(data.prior)}. ${data.failures.length ? "Some requests failed. " : ""}Data may be delayed or omitted; average position is an aggregate. Google combines AI features with other Web results, so this does not measure AI citations.`,url:searchConsoleReportUrl(data.property)});
      } else checks.push({group:"search",label:"Google Search Console",status:"unmeasured",detail:"The authorized report failed. Check property coverage and access."});
      if (queries.status === "fulfilled" && queries.value.rows.length) checks.push({group:"search",label:"Observed search queries",status:"unmeasured",detail:`${queries.value.startDate}–${queries.value.endDate}: ${queries.value.rows.slice(0,5).map(r => `${r.query} (${r.impressions} impressions, ${r.clicks} clicks)`).join("; ")}. Returned rows may be incomplete and do not measure total demand.`,url:searchConsoleReportUrl(queries.value.property),fix:`Review whether ${game.title || "the game"}'s page answers the observed queries accurately.`});
      review.checks = checks;
    } catch { /* Public-page findings remain useful if reporting fails. */ }
  }
  return put(workspace, "discovery_review", review);
}
