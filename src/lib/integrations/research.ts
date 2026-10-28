import { createHash } from "node:crypto";
import { load } from "cheerio";
import type {
  Analytics,
  Finding,
  Game,
  ProviderSecret,
  ResearchRun,
} from "../types";
import { api } from "./common";
import { braveSearch } from "./brave";
import {
  searchConsoleComparison,
  searchConsoleReportUrl,
} from "./search-console";
import { fetchPublic } from "./safe-fetch";
type FindingDraft = Omit<Finding, "id" | "createdAt" | "status">;
type PageFacts = {
  url: string;
  title: string;
  description: string;
  words: number;
  robots: string;
  xRobots: string;
};
const cleanUrl = (input: string) => {
  const u = new URL(input);
  u.search = "";
  u.hash = "";
  return u.href;
};
const cleanQuery = (s: string) =>
  s
    .replace(/[^\p{L}\p{N} '-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
function extractPage(url: string, body: string, xRobots: string): PageFacts {
  const $ = load(body);
  const meta = (name: string) =>
    $("meta")
      .toArray()
      .filter((e) => ($(e).attr("name") || "").toLowerCase() === name)
      .map((e) => ($(e).attr("content") || "").trim())
      .filter(Boolean)
      .join("; ")
      .slice(0, 300);
  const title = $("title").first().text().trim().slice(0, 200),
    description = meta("description"),
    robots = [meta("robots"), meta("googlebot")].filter(Boolean).join("; ");
  $("script,style,noscript,template").remove();
  const content = $("body").text().replace(/\s+/g, " ").trim();
  return {
    url: cleanUrl(url),
    title,
    description,
    robots,
    xRobots: xRobots.slice(0, 300),
    words: content ? content.split(/\s+/).length : 0,
  };
}
export async function runResearch({
  game,
  analytics,
  connections,
  previous,
}: {
  game: Game;
  analytics: Analytics;
  connections: Record<string, ProviderSecret>;
  previous?: unknown;
}): Promise<{
  findings: FindingDraft[];
  coverage: ResearchRun["coverage"];
  fingerprint: string;
  pageBaseline?: { url: string; observedAt: string; words: number };
}> {
  const findings: FindingDraft[] = [];
  const coverage: ResearchRun["coverage"] = [];
  const pages: Map<number, PageFacts> = new Map();
  const add = (
    title: string,
    detail: string,
    type: Finding["type"],
    evidence: Finding["evidence"],
    priority: Finding["priority"] = "medium",
  ) =>
    findings.push({ gameId: game.id, title, detail, type, priority, evidence });
  const jobs: Array<Promise<void>> = [];
  for (const [i, page] of [game.url, ...game.competitors.slice(0, 3)].entries())
    jobs.push(
      (async () => {
        const source = i === 0 ? "Game page" : `Competitor ${i}`;
        try {
          const res = await fetchPublic(page);
          if (res.status < 200 || res.status >= 300)
            throw new Error("HTTP error");
          const facts = extractPage(res.url, res.body, res.xRobotsTag || "");
          pages.set(i, facts);
          coverage.push({
            source,
            status: "complete",
            detail: `HTTP ${res.status}; ${res.elapsedMs} ms for this fetch including redirects; title ${facts.title ? "present" : "missing"}; description ${facts.description ? "present" : "missing"}; ${facts.words} estimated words in static HTML body. This is not a real-user performance measurement.`,
          });
          if (i === 0 && (!facts.title || !facts.description))
            add(
              "Page metadata needs attention",
              `The fetched page ${!facts.title ? "has no title" : ""}${!facts.title && !facts.description ? " and " : ""}${!facts.description ? "has no meta description" : ""}. Review search presentation; this check does not measure rankings.`,
              "observation",
              [{ label: "Fetched game page", url: facts.url }],
            );
          if (i > 0)
            add(
              `Competitor page: ${facts.title || "untitled"}`,
              `Public page description: ${facts.description || "none found"}. Static HTML body: ${facts.words} words. This does not estimate traffic.`,
              "observation",
              [{ label: "Public competitor page", url: facts.url }],
              "low",
            );
          if (
            i === 0 &&
            /(?:^|[,:;\s])(noindex|none)(?:$|[,:;\s])/i.test(
              `${facts.robots}; ${facts.xRobots}`,
            )
          )
            add(
              "Page declares an indexing restriction",
              `Robots meta: ${facts.robots || "none found"}; X-Robots-Tag: ${facts.xRobots || "none found"}. Review the crawler-specific rules; a declaration does not prove indexing status.`,
              "observation",
              [{ label: "Fetched game page", url: facts.url }],
              "high",
            );
        } catch {
          coverage.push({
            source,
            status: "failed",
            detail:
              "Public page could not be fetched safely or returned an error.",
          });
        }
      })(),
    );
  for (const path of ["/robots.txt", "/sitemap.xml"])
    jobs.push(
      (async () => {
        try {
          const res = await fetchPublic(new URL(path, game.url).href);
          let detail = `HTTP ${res.status}; checked ${cleanUrl(res.url)}. Existence does not establish search indexing.`;
          if (path === "/robots.txt" && res.status >= 200 && res.status < 300) {
            const lines = res.body
              .split(/\r?\n/)
              .map((x) => x.replace(/#.*/, "").trim())
              .filter((x) =>
                /^(user-agent|allow|disallow|sitemap)\s*:/i.test(x),
              )
              .slice(0, 20)
              .map((x) => x.slice(0, 160));
            detail += ` First directives: ${lines.length ? lines.join(" | ") : "none found"}. This is not an evaluation of crawler-specific precedence or path matching.`;
            if (lines.length)
              add(
                "Review robots.txt directives",
                `The public robots.txt declares ${lines.length} shown directive(s). Inspect source for the complete rules; crawler matching and effective access have not been evaluated.`,
                "observation",
                [{ label: "robots.txt", url: cleanUrl(res.url) }],
                "low",
              );
          }
          coverage.push({
            source: path,
            status:
              res.status >= 200 && res.status < 300
                ? "complete"
                : "unavailable",
            detail,
          });
        } catch {
          coverage.push({
            source: path,
            status: "failed",
            detail: "Could not fetch safely.",
          });
        }
      })(),
    );
  const title = cleanQuery(game.title),
    genre = cleanQuery(game.genre);
  const queries: [string, string][] = [];
  if (title) queries.push(["title", `"${title}"`]);
  if (genre) queries.push(["genre", `${genre} browser game players`]);
  for (const provider of ["x", "reddit"] as const)
    for (const [kind, query] of queries)
      jobs.push(
        (async () => {
          const source = `${provider} ${kind} search`,
            secret = connections[provider];
          if (!secret?.token) {
            coverage.push({
              source,
              status: "disconnected",
              detail: "Authorized API access is required.",
            });
            return;
          }
          try {
            if (provider === "x") {
              const q = new URLSearchParams({
                query: `${query} -is:retweet`,
                max_results: "10",
                "tweet.fields": "created_at",
              });
              const data = await api(
                `https://api.x.com/2/tweets/search/recent?${q}`,
                secret,
              );
              const rows = Array.isArray(data.data) ? data.data : [];
              coverage.push({
                source,
                status: "complete",
                detail: `${rows.length} search matches; matches may not refer to this game and do not represent all discussion.`,
              });
              for (const row of rows.slice(0, 3))
                if (/^\d+$/.test(String(row.id)))
                  add(
                    `X ${kind} search match`,
                    `${String(row.text || "").slice(0, 300)}. Search match only; relevance and ownership are unverified.`,
                    "observation",
                    [
                      {
                        label: "X post",
                        url: `https://x.com/i/web/status/${row.id}`,
                      },
                    ],
                    "low",
                  );
            } else {
              const q = new URLSearchParams({
                q: query,
                limit: "10",
                sort: "new",
                t: "week",
                type: "link",
              });
              const data = await api(
                `https://oauth.reddit.com/search?${q}`,
                secret,
                { headers: { "User-Agent": "web-game-marketing/1.0" } },
              );
              const rows = Array.isArray(data.data?.children)
                ? data.data.children
                : [];
              coverage.push({
                source,
                status: "complete",
                detail: `${rows.length} search matches; matches may not refer to this game and do not represent all discussion.`,
              });
              for (const row of rows.slice(0, 3)) {
                const item = row.data;
                if (
                  typeof item?.permalink === "string" &&
                  /^\/r\/[a-zA-Z0-9_]+\/comments\/[a-zA-Z0-9]+\//.test(
                    item.permalink,
                  )
                )
                  add(
                    `Reddit ${kind} search match`,
                    `${String(item.title || "").slice(0, 300)}. Search match only; relevance is unverified.`,
                    "observation",
                    [
                      {
                        label: "Reddit post",
                        url: `https://www.reddit.com${item.permalink.split("?")[0]}`,
                      },
                    ],
                    "low",
                  );
              }
            }
          } catch {
            coverage.push({
              source,
              status: "failed",
              detail:
                "Authorized search failed; check token, scope and API access.",
            });
          }
        })(),
      );
  if (!genre)
    coverage.push({
      source: "Genre and audience research",
      status: "unavailable",
      detail:
        "Add a genre to enable broader search queries; no audience profile was inferred.",
    });
  jobs.push(
    (async () => {
      const secret = connections.brave;
      if (!secret?.token) {
        coverage.push({
          source: "Web game discovery",
          status: "disconnected",
          detail:
            "An authorized Brave Search API key is required to discover candidates.",
        });
        return;
      }
      if (!genre) {
        coverage.push({
          source: "Web game discovery",
          status: "unavailable",
          detail: "Add a genre for candidate search.",
        });
        return;
      }
      try {
        const { results } = await braveSearch(
          `${genre} browser games play online`,
          secret,
        );
        coverage.push({
          source: "Web game discovery",
          status: "complete",
          detail: `${results.length} web results; candidates may be directories, irrelevant, or not playable browser games.`,
        });
        for (const result of results.slice(0, 5))
          add(
            `Web game candidate: ${result.title || "untitled"}`,
            `${result.description || "No description provided."} Search result only: confirm that this is a playable web game and relevant competitor.`,
            "opportunity",
            [{ label: "Brave Search result", url: result.url }],
            "low",
          );
      } catch {
        coverage.push({
          source: "Web game discovery",
          status: "failed",
          detail: "Brave Search failed; check API key, plan and quota.",
        });
      }
    })(),
  );
  jobs.push(
    (async () => {
      const secret = connections.search_console;
      if (!secret?.token) {
        coverage.push({
          source: "Google Search Console",
          status: "disconnected",
          detail:
            "Connect an authorized property to measure Google Search visibility.",
        });
        return;
      }
      try {
        const result = await searchConsoleComparison(secret, game.url);
        const available = [result.recent, result.prior].filter(Boolean).length;
        coverage.push({
          source: "Google Search Console",
          status:
            result.failures.length === 2
              ? "failed"
              : result.failures.length
                ? "partial"
                : available
                  ? "complete"
                  : "unavailable",
          detail: `Finalized web-search data for the exact game URL; ${available} of 2 periods have rows${result.failures.length ? `; ${result.failures.join(" and ")} period request failed` : ""}. Google may use a different canonical URL or delay data; an empty period is not assumed to be zero.`,
        });
        const format = (label: string, p: typeof result.recent) =>
          p
            ? `${label} ${p.startDate}–${p.endDate}: ${p.clicks} clicks, ${p.impressions} impressions, ${(p.ctr * 100).toFixed(2)}% CTR, average position ${p.position.toFixed(2)}`
            : `${label}: unavailable`;
        if (available)
          add(
            "Google Search visibility",
            `${format("Recent", result.recent)}; ${format("Prior", result.prior)}. Exact-page Google web-search data; average position is an aggregate, not a fixed rank. Changes do not establish cause.`,
            "observation",
            [
              {
                label: "Search Console performance report",
                url: searchConsoleReportUrl(result.property),
              },
              { label: "Game URL", url: result.page },
            ],
            "low",
          );
      } catch {
        coverage.push({
          source: "Google Search Console",
          status: "failed",
          detail:
            "Property or query failed. Check that the selected property covers the game URL and that the token has access.",
        });
      }
    })(),
  );
  const human = analytics.sessionsList.filter(
    (s) => s.kind === "human" && s.gameId === game.id,
  );
  const sessionEvidence = (rows: typeof human) =>
    rows
      .slice(0, 3)
      .map((s) => ({
        label: `Human session ${s.id}`,
        url: `/api/sessions/${encodeURIComponent(s.id)}`,
      }));
  if (analytics.sessions > 0) {
    coverage.push({
      source: "Human telemetry",
      status: "complete",
      detail: `${analytics.sessions} sessions; last event ${analytics.lastEventAt || "unknown"}. Session examples come from the supplied list and may be partial.`,
    });
    add(
      "Human play funnel",
      `${analytics.firstActions} first actions, ${analytics.starts} starts and ${analytics.completions} completions across ${analytics.sessions} human sessions. Counts are observational and may reflect incomplete instrumentation.`,
      "observation",
      sessionEvidence(human),
    );
    if (
      analytics.starts >= 10 &&
      analytics.completions / analytics.starts < 0.5
    )
      add(
        "Investigate incomplete rounds",
        `Fewer than half of ${analytics.starts} observed starts reached completion. Inspect sessions and errors before attributing a cause.`,
        "hypothesis",
        sessionEvidence(human.filter((s) => !s.completed)),
      );
    const errors = human.filter((s) => s.errors > 0);
    const steps = new Map<string, number>();
    for (const s of errors)
      steps.set(
        s.lastStep || "unknown",
        (steps.get(s.lastStep || "unknown") || 0) + 1,
      );
    const top = [...steps.entries()].sort(
      (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
    )[0];
    if (top)
      add(
        "Error-bearing sessions: last recorded step",
        `In the supplied session list, ${top[1]} error-bearing session(s) last recorded “${top[0]}”. The last step is not necessarily where the error occurred; inspect the event timelines.`,
        "observation",
        sessionEvidence(
          errors.filter((s) => (s.lastStep || "unknown") === top[0]),
        ),
        "medium",
      );
  } else
    coverage.push({
      source: "Human telemetry",
      status: "unavailable",
      detail: "No human sessions available.",
    });
  await Promise.all(jobs);
  const own = pages.get(0);
  for (const [index, other] of pages) {
    if (index === 0 || !own) continue;
    add(
      `Page metadata comparison: competitor ${index}`,
      `Game page: title ${own.title ? "present" : "missing"}, description ${own.description ? "present" : "missing"}, ${own.words} estimated static body words. Competitor page: title ${other.title ? "present" : "missing"}, description ${other.description ? "present" : "missing"}, ${other.words} estimated static body words. These are same-run observations, not ranking or quality scores.`,
      "observation",
      [
        { label: "Game page", url: own.url },
        { label: "Competitor page", url: other.url },
      ],
      "low",
    );
  }
  // A historical baseline must be explicitly supplied by the caller, with a source URL and dated values.
  const baseline = previous as
    | { url?: unknown; observedAt?: unknown; words?: unknown }
    | undefined;
  if (
    own &&
    baseline &&
    baseline.url === own.url &&
    typeof baseline.observedAt === "string" &&
    typeof baseline.words === "number" &&
    Number.isFinite(baseline.words) &&
    baseline.words >= 0
  )
    add(
      "Static page text compared with prior snapshot",
      `Current static body: ${own.words} words; supplied snapshot from ${baseline.observedAt.slice(0, 32)}: ${baseline.words} words. Counts exclude rendered content and do not establish search performance.`,
      "observation",
      [
        { label: "Current game page", url: own.url },
        { label: "Prior snapshot supplied by workspace" },
      ],
      "low",
    );
  else
    coverage.push({
      source: "Historical page baseline",
      status: "unavailable",
      detail:
        "No comparable dated page snapshot supplied; same-run competitor comparisons do not show change over time.",
    });
  findings.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  coverage.sort((a, b) => a.source.localeCompare(b.source));
  return {
    findings,
    coverage,
    fingerprint: createHash("sha256")
      .update(JSON.stringify(findings))
      .digest("hex"),
    ...(own
      ? {
          pageBaseline: {
            url: own.url,
            observedAt: new Date().toISOString(),
            words: own.words,
          },
        }
      : {}),
  };
}
