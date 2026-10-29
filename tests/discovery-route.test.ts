import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ workspace: "a", authenticated: true, calls: [] as string[] }));
vi.mock("../src/lib/auth", async () => { const actual = await vi.importActual<typeof import("../src/lib/auth")>("../src/lib/auth"); return { ...actual, requireIdentity: async () => { if (!state.authenticated) throw new actual.HttpError(401, "Sign in required."); return { workspace_id: state.workspace }; } }; });
vi.mock("../src/lib/integrations/safe-fetch", () => ({ fetchPublic: async (url: string) => { state.calls.push(url); return { url, status: 200, contentType: "text/html", xRobotsTag: "", elapsedMs: 1, body: "<title>Game</title><body>Play</body>" }; } }));
let db: typeof import("../src/lib/db"); let service: typeof import("../src/lib/discovery-review"); let routes: typeof import("../src/app/api/games/[id]/discovery/route");
const game = { id: "g", title: "Game", url: "https://example.com/game", competitors: [] };
const context = { params: Promise.resolve({ id: "g" }) };
const request = (method = "GET", origin = "http://localhost:3000") => new Request("http://localhost:3000/api/games/g/discovery", { method, headers: { origin } });
beforeAll(async () => { delete process.env.DATABASE_URL; delete process.env.VERCEL; process.env.LOCAL_DATABASE_PATH = "memory://"; db = await import("../src/lib/db"); service = await import("../src/lib/discovery-review"); routes = await import("../src/app/api/games/[id]/discovery/route"); });
beforeEach(async () => { state.workspace = "a"; state.authenticated = true; state.calls = []; await db.query("DELETE FROM records"); await db.put("a", "game", game); });
describe("discovery route and cache", () => {
  it("requires authentication, workspace ownership and same-origin refresh", async () => {
    state.authenticated = false; expect((await routes.GET(request(), context)).status).toBe(401);
    state.authenticated = true; state.workspace = "b"; expect((await routes.GET(request(), context)).status).toBe(404); expect((await routes.POST(request("POST"), context)).status).toBe(404);
    state.workspace = "a"; expect((await routes.POST(request("POST", "https://evil.example"), context)).status).toBe(403); expect(state.calls).toEqual([]);
  });
  it("refreshes only public deterministic sources, then serves isolated cache without fetching", async () => {
    expect((await routes.POST(request("POST"), context)).status).toBe(200);
    expect(state.calls).toEqual([game.url, "https://example.com/robots.txt", "https://example.com/sitemap.xml"]);
    state.calls = []; const result = await routes.GET(request(), context); expect((await result.json()).review.source).toBe("public audit"); expect(state.calls).toEqual([]);
    expect(await service.readDiscovery("b", game as never)).toBeUndefined();
    expect((await service.readDiscovery("a", { ...game, url: "https://example.com/changed" } as never))?.stale).toBe(true);
    expect((await service.readDiscovery("a", { ...game, url: game.url + "?mode=one" } as never))?.stale).toBe(true);
  });
  it("exposes the dated prior research baseline and marks a changed URL stale", async () => {
    await db.put("a", "seo_baseline", { id: "g", url: game.url, observedAt: "2026-01-01T00:00:01Z", words: 42 });
    await db.put("a", "run", { id: "r", gameId: "g", startedAt: "2026-01-01T00:00:00Z", findings: ["f"], coverage: [{ source: "Game page", status: "complete", detail: "HTTP 200; title missing" }] });
    await db.put("a", "finding", { id: "f", gameId: "g", title: "Page metadata needs attention", detail: "LATER MUTABLE CONTENT", evidence: [{ url: game.url }] });
    const review = await service.readDiscovery("a", { ...game, url: "https://example.com/new" } as never);
    expect(review).toMatchObject({ source: "research baseline", sourceUrl: game.url, observedAt: "2026-01-01T00:00:01Z", stale: true });
    expect(review?.checks[0].detail).toContain("title missing"); expect(JSON.stringify(review)).not.toContain("LATER MUTABLE CONTENT"); expect(state.calls).toEqual([]);
    expect((await service.readDiscovery("a", { ...game, url: game.url + "?mode=one" } as never))?.stale).toBe(true);
  });
});
