import { describe, expect, it } from "vitest";
import { auditDiscovery } from "../src/lib/discovery-review";
import type { Game } from "../src/lib/types";
import type { PublicResponse } from "../src/lib/integrations/safe-fetch";
const game = { id: "g", url: "https://example.com/game" } as Game;
const response = (url: string, body: string, overrides: Partial<PublicResponse> = {}): PublicResponse => ({ url, body, status: 200, contentType: "text/html", xRobotsTag: "", elapsedMs: 1, ...overrides });
describe("discovery review", () => {
  it("checks only sanitized public URLs and does not claim indexing from robots or sitemap", async () => {
    const urls: string[] = [];
    const review = await auditDiscovery(game, async url => { urls.push(url); return response(url, '<title>Game</title><meta name="description" content="Play"><body>Play now</body>'); });
    expect(urls).toEqual(["https://example.com/game", "https://example.com/robots.txt", "https://example.com/sitemap.xml"]);
    expect(review.checks.find(c => c.label === "Page title")?.status).toBe("passed");
    expect(review.checks.find(c => c.label === "Indexing directives")?.status).toBe("unmeasured");
    expect(review.checks.find(c => c.label === "/sitemap.xml")?.status).toBe("unmeasured");
    expect(JSON.stringify(review)).not.toContain("private");
  });
  it("does not fetch a query-bearing page or expose the query", async () => {
    const urls: string[] = [];
    const review = await auditDiscovery({ ...game, url: "https://example.com/game?token=private" }, async url => { urls.push(url); return response(url, ""); });
    expect(urls).toEqual(["https://example.com/robots.txt", "https://example.com/sitemap.xml"]);
    expect(review.checks.find(c => c.label === "Public game page")).toMatchObject({ status: "unmeasured", detail: expect.stringContaining("Query-specific page was not fetched") });
    expect(JSON.stringify(review)).not.toContain("private");
  });
  it("surfaces restrictions and bounded failures without leaking errors", async () => {
    const review = await auditDiscovery(game, async url => { if (url.endsWith("/game")) return response(url, "<body></body>", { xRobotsTag: "noindex" }); throw new Error("private secret"); });
    expect(review.checks.find(c => c.label === "Indexing directives")?.status).toBe("attention");
    expect(review.checks.find(c => c.label === "Meta description")?.fix).toBeTruthy();
    expect(review.checks.find(c => c.label === "/robots.txt")?.detail).toContain("failed");
    expect(JSON.stringify(review)).not.toContain("secret");
  });
  it("reports JSON-LD syntax, game schema, canonical differences and static metadata", async () => {
    const urls: string[] = [];
    const review = await auditDiscovery(game, async url => { urls.push(url); return response(url, `<html lang="en"><head><meta name="viewport" content="width=device-width"><meta property="og:title" content="Game"><meta property="og:description" content="Play"><meta property="og:image" content="https://example.com/img.png"><link rel="canonical" href="http://127.0.0.1/private?secret=1"><script type="application/ld+json">{broken</script><script type="application/ld+json">{"@graph":[{"@type":["Thing","VideoGame"]}]}</script></head><body>Game</body></html>`); });
    expect(review.checks.find(c => c.label === "JSON-LD syntax")).toMatchObject({status:"attention",detail:expect.stringContaining("1 could not be parsed")});
    expect(review.checks.find(c => c.label === "Game structured data")?.status).toBe("passed");
    expect(review.checks.find(c => c.label === "Canonical link")?.status).toBe("attention");
    expect(review.checks.find(c => c.label === "Document language")?.status).toBe("passed");
    expect(review.checks.find(c => c.label === "Viewport hint")?.status).toBe("passed");
    expect(review.checks.find(c => c.label === "Open Graph image")?.status).toBe("passed");
    expect(urls).toEqual(["https://example.com/game", "https://example.com/robots.txt", "https://example.com/sitemap.xml"]);
    expect(JSON.stringify(review)).not.toContain("secret=1");
  });
  it("matches relative canonical URLs and does not require game schema", async () => {
    const review = await auditDiscovery(game, async url => response(url, '<link rel="canonical" href="/game"><script type="application/ld+json">{"@type":"Article"}</script>'));
    expect(review.checks.find(c => c.label === "Canonical link")?.status).toBe("passed");
    expect(review.checks.find(c => c.label === "JSON-LD syntax")?.status).toBe("passed");
    expect(review.checks.find(c => c.label === "Game structured data")?.detail).toContain("not required");
  });
  it("rejects a private address using the real public fetcher", async () => {
    const review = await auditDiscovery({...game,url:"http://127.0.0.1/private"});
    expect(review.checks.find(c => c.label === "Public game page")?.status).toBe("unmeasured");
    expect(review.checks.find(c => c.label === "/robots.txt")?.detail).toContain("failed");
  });
});
