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
});
