import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { CompetitorEvidence, CompetitorTarget } from "../src/lib/competitor-types";

const state = vi.hoisted(() => ({ workspace: "owner-a", signedIn: true, collect: vi.fn() }));
vi.mock("../src/lib/auth", async () => {
  const actual = await vi.importActual<typeof import("../src/lib/auth")>("../src/lib/auth");
  return { ...actual, requireIdentity: async () => {
    if (!state.signedIn) throw new actual.HttpError(401, "Sign in required.");
    return { workspace_id: state.workspace };
  } };
});
vi.mock("../src/lib/integrations/dataforseo-competitors", () => ({ collectCompetitorEvidence: state.collect }));

let db: typeof import("../src/lib/db");
let routes: typeof import("../src/app/api/games/[id]/competitors/route");
let actions: typeof import("../src/app/api/actions/route");
const base = "http://localhost:3000";
const game = { id: "g", title: "Game", url: "https://example.com/games/one" };
const context = { params: Promise.resolve({ id: game.id }) };
const market = { keyword: "browser puzzle games", country: "GB", device: "mobile" };
const web = { title: "Other game", url: "https://example.org/games/two" };
const ios = { title: "iOS rival", url: "https://apps.apple.com/gb/app/puzzle/id123456789?uo=4" };
const android = { title: "Android rival", url: "https://play.google.com/store/apps/details?id=com.studio.puzzle&hl=en" };
function request(method = "GET", body?: unknown, origin = base) {
  return new Request(base + "/api/games/g/competitors", {
    method, headers: { origin, "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
const save = (entries: object[], revision = 0) => routes.PUT(request("PUT", { entries, revision }), context);

beforeAll(async () => {
  vi.stubEnv("DATABASE_URL", "");
  vi.stubEnv("VERCEL", "");
  vi.stubEnv("LOCAL_DATABASE_PATH", "memory://");
  db = await import("../src/lib/db");
  routes = await import("../src/app/api/games/[id]/competitors/route");
  actions = await import("../src/app/api/actions/route");
});
beforeEach(async () => {
  vi.stubEnv("DATAFORSEO_LOGIN", "fixture-login");
  vi.stubEnv("DATAFORSEO_PASSWORD", "fixture-password");
  vi.stubEnv("BLAZE_COMPETITOR_WORKSPACE_IDS", "");
  state.workspace = "owner-a";
  state.signedIn = true;
  state.collect.mockReset();
  state.collect.mockImplementation(async (targets: CompetitorTarget[]): Promise<CompetitorEvidence> => ({
    web: Object.fromEntries(targets.filter(t => t.platform === "web").map(t => [t.id, { rank: 2, estimatedVisits: 120 }])),
    stores: Object.fromEntries(targets.filter(t => t.platform === "ios").map(t => [t.id, { rankedKeywords: 12, topTenKeywords: 5, estimatedSearchVolume: 250 }])),
    sources: { search: "ok", traffic: "ok", ios: "ok", android: "unavailable" },
  }));
  await db.query("DELETE FROM records");
  await db.query("DELETE FROM rate_windows");
  await db.put("owner-a", "game", game);
  await db.put("owner-a", "game", { ...game, id: "another" });
});

describe("per-game competitors", () => {
  it("requires a signed-in owner and rejects cross-origin changes", async () => {
    state.signedIn = false;
    expect((await routes.GET(request(), context)).status).toBe(401);
    state.signedIn = true;
    state.workspace = "owner-b";
    expect((await routes.GET(request(), context)).status).toBe(404);
    expect((await save([web])).status).toBe(404);
    state.workspace = "owner-a";
    expect((await routes.PUT(request("PUT", { entries: [web], revision: 0 }, "https://elsewhere.example"), context)).status).toBe(403);
    expect(state.collect).not.toHaveBeenCalled();
  });

  it("saves a mixed watchlist offline and canonicalizes store IDs without exposing it to other games", async () => {
    const created = await save([web, ios, android]);
    expect(created.status).toBe(200);
    expect(created.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await created.json()).toMatchObject({
      providerConnected: false, latest: null,
      watchlist: { revision: 1, entries: [
        { platform: "web", url: web.url },
        { platform: "ios", appId: "123456789", url: "https://apps.apple.com/app/id123456789" },
        { platform: "android", appId: "com.studio.puzzle", url: "https://play.google.com/store/apps/details?id=com.studio.puzzle" },
      ] },
      targets: [{ title: game.title, owned: true }, { title: web.title }, { title: ios.title }, { title: android.title }],
    });
    const otherGame = await routes.GET(request(), { params: Promise.resolve({ id: "another" }) });
    expect((await otherGame.json()).watchlist.entries).toEqual([]);
    expect((await routes.POST(request("POST", market), context)).status).toBe(409);
    expect(state.collect).not.toHaveBeenCalled();
    await db.put("owner-b", "game", game);
    state.workspace = "owner-b";
    expect((await (await routes.GET(request(), context)).json()).watchlist.entries).toEqual([]);
  });

  it("rejects duplicate listings, unsafe URLs, oversized lists and stale edits", async () => {
    expect((await save([ios, { ...ios, url: "https://apps.apple.com/us/app/id123456789" }])).status).toBe(400);
    expect((await save([{ title: "Private URL", url: "http://127.0.0.1/admin" }])).status).toBe(400);
    expect((await save([{ title: "Private query", url: "https://example.com/game?token=test" }])).status).toBe(400);
    expect((await save([ { ...web, owned: true } ])).status).toBe(400);
    expect((await save(Array.from({ length: 11 }, (_, i) => ({ title: "Game " + i, url: web.url + i })))).status).toBe(400);
    expect((await save([web])).status).toBe(200);
    expect((await save([ios])).status).toBe(409);
    expect((await save([ios], 1)).status).toBe(200);
    const actual = await (await routes.GET(request(), context)).json();
    expect(actual.watchlist.entries.map((entry: CompetitorTarget) => entry.title)).toEqual([ios.title]);
  });

  it("requires an explicit refresh, caps repeat spending, and retains a dated partial report", async () => {
    vi.stubEnv("BLAZE_COMPETITOR_WORKSPACE_IDS", "owner-a");
    await save([web, ios, android]);
    const before = await (await routes.GET(request(), context)).json();
    expect(before.providerConnected).toBe(true);
    expect(state.collect).not.toHaveBeenCalled();
    expect((await routes.POST(request("POST", { ...market, keyword: "site:example.com" }), context)).status).toBe(400);
    expect((await routes.POST(request("POST", { ...market, workspace: "owner-b" }), context)).status).toBe(400);
    const result = await routes.POST(request("POST", market), context);
    expect(result.status).toBe(200);
    const report = await result.json();
    expect(report.latest).toMatchObject({ market, evidence: { sources: { android: "unavailable", search: "ok" } } });
    expect(report.latest.observedAt).toBeTruthy();
    expect(Object.keys(report.latest.evidence.web)).toHaveLength(2);
    expect(Object.values(report.latest.evidence.stores)).toEqual([{ rankedKeywords: 12, topTenKeywords: 5, estimatedSearchVolume: 250 }]);
    expect(JSON.stringify(report)).not.toContain("fixture-password");
    expect((await routes.POST(request("POST", market), context)).status).toBe(429);
    expect(state.collect).toHaveBeenCalledTimes(1);
    expect((await (await save([web], 1)).json()).stale).toBe(true);
    vi.stubEnv("BLAZE_COMPETITOR_WORKSPACE_IDS", "owner-b");
    const disconnected = await (await routes.GET(request(), context)).json();
    expect(disconnected).toMatchObject({ latest: null, providerConnected: false });
  });

  it("registers an Android-only game without a web telemetry setup", async () => {
    const response = await actions.POST(request("POST", { action: "add_mobile_game", ...android }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.game).toMatchObject({ title: android.title, storePlatform: "android", origins: [], dailyEnabled: false });
    const competitorPage = await (await routes.GET(request(), { params: Promise.resolve({ id: body.game.id }) })).json();
    expect(competitorPage.targets).toMatchObject([{ platform: "android", owned: true, appId: "com.studio.puzzle" }]);
    expect((await actions.POST(request("POST", { action: "update_game", id: body.game.id, origins: ["https://example.com"] }))).status).toBe(400);
  });
});
