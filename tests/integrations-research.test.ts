import { afterEach, describe, expect, it, vi } from "vitest";
import type { Analytics, Game } from "../src/lib/types";
vi.mock("../src/lib/integrations/safe-fetch", () => ({
  fetchPublic: vi.fn(async (url: string) => ({
    url,
    status: 200,
    contentType: "text/html",
    elapsedMs: 25,
    xRobotsTag:
      url.includes("game.example") &&
      !url.endsWith(".txt") &&
      !url.endsWith(".xml")
        ? "googlebot: noindex"
        : "",
    body: url.endsWith("/robots.txt")
      ? "User-agent: *\nDisallow: /private\nSitemap: https://game.example/sitemap.xml"
      : url.endsWith("/sitemap.xml")
        ? "<urlset/>"
        : '<html><head><title>A page</title><meta name="description" content="Example"></head><body>one two three</body></html>',
  })),
}));
import { runResearch, testConnection } from "../src/lib/integrations";
import { fetchPublic } from "../src/lib/integrations/safe-fetch";
import whotManifest from "./fixtures/forever-whot.json";
const game: Game = {
  id: "g",
  title: "My Game",
  url: "https://game.example/",
  description: "",
  image: "",
  genre: "puzzle",
  sdkKey: "",
  origins: [],
  createdAt: "",
  dailyEnabled: true,
  competitors: ["https://competitor.example/"],
};
const analytics: Analytics = {
  sessions: 1,
  players: 1,
  starts: 1,
  completions: 0,
  replays: 0,
  returns: 0,
  errorSessions: 1,
  firstActions: 1,
  lastEventAt: null,
  trend: [],
  funnel: [],
  countries: [],
  sources: [],
  devices: [],
  dropoffs: [],
  retention: [],
  campaigns: [],
  heatmap: [],
  syntheticSessions: 0,
  sessionsList: [
    {
      id: "s-1",
      gameId: "g",
      playerId: "p",
      kind: "human",
      country: "",
      device: "",
      source: "",
      campaign: "",
      startedAt: "",
      lastAt: "",
      events: 2,
      completed: false,
      lastStep: "round_start",
      errors: 1,
      duration: 1,
    },
  ],
};
afterEach(() => vi.unstubAllGlobals());
describe("research evidence and source coverage", () => {
  it("labels genre results, preserves page evidence and links error sessions", async () => {
    const fetch = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.startsWith("https://api.search.brave.com"))
        return Response.json({
          type: "search",
          web: {
            results: [
              {
                title: "Puzzle directory",
                url: "https://other.example/?tracking=1",
                description: "A game list",
              },
            ],
          },
        });
      if (url.startsWith("https://api.x.com"))
        return Response.json({ data: [{ id: "123", text: "Puzzle post" }] });
      if (url.startsWith("https://oauth.reddit.com"))
        return Response.json({
          data: {
            children: [
              {
                data: {
                  title: "Puzzle discussion",
                  permalink: "/r/games/comments/abc/post/",
                },
              },
            ],
          },
        });
      throw new Error("unexpected");
    });
    vi.stubGlobal("fetch", fetch);
    const result = await runResearch({
      game,
      analytics,
      connections: {
        brave: { token: "b" },
        x: { token: "x" },
        reddit: { token: "r" },
      },
    });
    expect(fetch).toHaveBeenCalledTimes(5);
    expect(result.coverage.map((x) => x.source)).toEqual(
      expect.arrayContaining([
        "x title search",
        "x genre search",
        "reddit title search",
        "reddit genre search",
        "Web game discovery",
      ]),
    );
    expect(
      result.findings.find((x) => x.title.includes("candidate"))?.detail,
    ).toContain("confirm");
    expect(
      result.findings.find((x) => x.title.includes("candidate"))?.evidence[0]
        .url,
    ).toBe("https://other.example/");
    expect(
      result.findings.find(
        (x) => x.title === "Page declares an indexing restriction",
      ),
    ).toBeTruthy();
    expect(
      result.findings.find((x) => x.title.includes("metadata comparison"))
        ?.evidence,
    ).toHaveLength(2);
    const error = result.findings.find((x) =>
      x.title.includes("Error-bearing"),
    );
    expect(error?.detail).toContain("not necessarily where");
    expect(error?.evidence[0].url).toBe("/api/sessions/s-1");
    expect(
      result.coverage.find((x) => x.source === "/robots.txt")?.detail,
    ).toContain("Disallow: /private");
    expect(
      result.coverage.find((x) => x.source === "Historical page baseline")
        ?.status,
    ).toBe("unavailable");
  });
  it("reports disconnected discovery and validates a real Brave response for connection", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          Response.json({ type: "search", web: { results: [] } }),
        ),
    );
    const result = await runResearch({ game, analytics, connections: {} });
    expect(
      result.coverage.find((x) => x.source === "Web game discovery")?.status,
    ).toBe("disconnected");
    expect(await testConnection("brave", { token: "key" })).toMatchObject({
      connected: true,
    });
  });
  it("surfaces actual Search Console data with an evidence link", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          rows: [{ clicks: 8, impressions: 100, ctr: 0.08, position: 4.2 }],
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          rows: [{ clicks: 5, impressions: 90, ctr: 5 / 90, position: 5 }],
        }),
      );
    vi.stubGlobal("fetch", fetch);
    const result = await runResearch({
      game,
      analytics,
      connections: {
        search_console: { token: "token", accountId: "sc-domain:game.example" },
      },
    });
    const finding = result.findings.find(
      (f) => f.title === "Google Search visibility",
    );
    expect(finding?.detail).toContain(
      "8 clicks, 100 impressions, 8.00% CTR, average position 4.20",
    );
    expect(finding?.detail).toContain("5 clicks, 90 impressions");
    expect(finding?.evidence[0].url).toContain(
      "search.google.com/search-console",
    );
    expect(
      result.coverage.find((c) => c.source === "Google Search Console")?.status,
    ).toBe("complete");
  });
  it("grounds candidate advice in the matching manifest and separates observed queries", async () => {
    const fetchMock = vi.mocked(fetchPublic);
    const original = fetchMock.getMockImplementation()!;
    const manifest = whotManifest;
    fetchMock.mockImplementation(async (url, redirects) => url.endsWith("/forever.json") ? { status: 200, url, body: JSON.stringify(manifest), contentType: "application/json", elapsedMs: 1, xRobotsTag: "" } : original(url, redirects));
    vi.stubGlobal("fetch", vi.fn(async (_input: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      return Response.json({ rows: body.dimensions ? [
        { keys: ["whot rules"], clicks: 3, impressions: 30, ctr: 0.1, position: 4.5 },
        { keys: ["private@example.com"], clicks: 1, impressions: 12, ctr: 0.1, position: 1 },
      ] : [{ clicks: 3, impressions: 30, ctr: 0.1, position: 4.5 }] });
    }));
    try {
      const result = await runResearch({ game: { ...game, url: "https://game.example/games/whot" }, analytics, connections: { search_console: { token: "token", accountId: "sc-domain:game.example" } } });
      const candidate = result.findings.find(f => f.title === "Unmeasured phrase candidate: WHOT how to play");
      expect(candidate?.detail).toContain("no search volume");
      expect(candidate?.detail).toContain(manifest.howToPlay[0]);
      expect(candidate?.evidence[0].url).toBe("https://game.example/games/whot/forever.json");
      expect(result.findings.find(f => f.title === "Review game-specific answers on the public page")?.detail).toContain("first FAQ question");
      const query = result.findings.find(f => f.title === "Observed search query: whot rules");
      expect(query?.detail).toContain("3 clicks, 30 impressions, 10.00% CTR, average position 4.50");
      expect(result.coverage.find(c => c.source === "Search Console queries")?.detail).toContain("1 suppressed or invalid");
      expect(JSON.stringify(result)).not.toContain("private@example.com");
      expect(result.coverage.find(c => c.source === "Game manifest")?.detail).toContain("SHA-256");
    } finally { fetchMock.mockImplementation(original); }
  });

});
