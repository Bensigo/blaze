import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ workspace: "a", signedIn: true }));
vi.mock("../src/lib/auth", async () => { const actual = await vi.importActual<typeof import("../src/lib/auth")>("../src/lib/auth"); return { ...actual, requireIdentity: async () => { if (!state.signedIn) throw new actual.HttpError(401, "Sign in required."); return { workspace_id: state.workspace }; } }; });
let db: typeof import("../src/lib/db");
let route: typeof import("../src/app/api/games/[id]/portal-gaps/route");
let competitors: typeof import("../src/lib/competitors");
let canonical: typeof import("../src/lib/portal-gaps")["canonicalPortalUrl"];
const game = { id: "g", title: "Own", url: "https://crazygames.com/game/own" };
const context = { params: Promise.resolve({ id: "g" }) };
function request(body?: unknown, origin = "http://localhost:3000") { return new Request("http://localhost:3000/api/games/g/portal-gaps", { method: body ? "PATCH" : "GET", headers: { origin, "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) }); }
beforeAll(async () => { vi.stubEnv("DATABASE_URL", ""); vi.stubEnv("VERCEL", ""); vi.stubEnv("LOCAL_DATABASE_PATH", "memory://"); db = await import("../src/lib/db"); route = await import("../src/app/api/games/[id]/portal-gaps/route"); competitors = await import("../src/lib/competitors"); canonical = (await import("../src/lib/portal-gaps")).canonicalPortalUrl; });
beforeEach(async () => { state.workspace = "a"; state.signedIn = true; await db.query("DELETE FROM records"); await db.query("DELETE FROM rate_windows"); await db.put("a", "game", game); });
describe("portal evidence", () => {
  it("accepts only individual listings and normalizes variants", () => {
    expect(canonical("http://www.poki.com/fr/g/some-game/?utm_source=x#play")).toEqual({ portalId: "poki", url: "https://poki.com/en/g/some-game" });
    expect(canonical("https://poki.com/FR/G/some-game")).toEqual({ portalId: "poki", url: "https://poki.com/en/g/some-game" });
    expect(canonical("https://creator.itch.io/my-game")).toEqual({ portalId: "itch", url: "https://creator.itch.io/my-game" });
    for (const url of ["https://crazygames.com.evil.com/game/a", "https://crazygames.com/games", "https://poki.com/en", "https://itch.io/game/new", "https://www.itch.io/game", "https://creator.itch.io/dashboard", "https://gamedistribution.com/games", "https://user@poki.com/en/g/a"]) expect(canonical(url)).toBeUndefined();
  });
  it("seeds listings, preserves uncertainty, and lets the owner save and remove evidence", async () => {
    const rival = competitors.competitorTarget({ title: "Rival", url: "https://poki.com/en/g/rival" });
    await db.put("a", "competitor_watchlist", { id: "g", revision: 1, entries: [rival] });
    let view = await (await route.GET(request(), context)).json();
    expect(view.rows[0].own).toMatchObject({ status: "listed", source: "watchlist" });
    expect(view.rows[1]).toMatchObject({ own: { status: "unknown" }, rivals: [{ targetId: rival.id, source: "watchlist" }] });
    expect((await route.PATCH(request({ action: "save_rival", portalId: "crazygames", targetId: rival.id, url: "https://crazygames.com/game/other" }), context)).status).toBe(200);
    expect((await route.PATCH(request({ action: "set_own", portalId: "poki", status: "not_listed" }), context)).status).toBe(200);
    expect((await route.PATCH(request({ action: "remove_rival", portalId: "poki", targetId: rival.id }), context)).status).toBe(200);
    view = await (await route.GET(request(), context)).json();
    expect(view.rows[1]).toMatchObject({ own: { status: "not_listed", source: "manual" }, rivals: [] });
    await db.put("a", "competitor_watchlist", { id: "g", revision: 2, entries: [] });
    view = await (await route.GET(request(), context)).json();
    expect(view.rows[0].rivals).toEqual([]);
  });
  it("does not silently lose concurrent updates", async () => {
    const results = await Promise.all([
      route.PATCH(request({ action: "set_own", portalId: "poki", status: "not_listed" }), context),
      route.PATCH(request({ action: "set_own", portalId: "itch", status: "not_listed" }), context),
    ]);
    expect(results.every(r => r.status === 200 || r.status === 409)).toBe(true);
    const view = await (await route.GET(request(), context)).json();
    expect(view.rows.filter((r: { own: { status: string } }) => r.own.status === "not_listed")).toHaveLength(results.filter(r => r.status === 200).length);
  });
  it("rejects conflicting own status and prevents duplicate rival links", async () => {
    const rival = competitors.competitorTarget({ title: "Rival", url: "https://poki.com/en/g/rival" });
    const other = competitors.competitorTarget({ title: "Other", url: "https://other.example/game" });
    await db.put("a", "competitor_watchlist", { id: "g", revision: 1, entries: [rival, other] });
    expect((await route.PATCH(request({ action: "set_own", portalId: "crazygames", status: "not_listed" }), context)).status).toBe(409);
    expect((await route.PATCH(request({ action: "save_rival", portalId: "crazygames", targetId: other.id, url: "https://www.crazygames.com/game/own" }), context)).status).toBe(400);
    expect((await route.PATCH(request({ action: "save_rival", portalId: "poki", targetId: other.id, url: "https://www.poki.com/FR/G/rival" }), context)).status).toBe(409);
    const removed = await route.PATCH(request({ action: "remove_rival", portalId: "poki", targetId: rival.id }), context);
    expect((await removed.json()).rows[1].rivals).toEqual([]);
  });
  it("enforces workspace, active web game, origin and input scope", async () => {
    state.signedIn = false; expect((await route.GET(request(), context)).status).toBe(401);
    state.signedIn = true; state.workspace = "b"; expect((await route.GET(request(), context)).status).toBe(404);
    state.workspace = "a"; expect((await route.PATCH(request({ action: "set_own", portalId: "poki", status: "not_listed" }, "https://evil.example"), context)).status).toBe(403);
    expect((await route.PATCH(request({ action: "set_own", portalId: "poki", status: "listed", url: "https://poki.com/en" }), context)).status).toBe(400);
    await db.put("a", "game", { ...game, storePlatform: "ios" }); expect((await route.GET(request(), context)).status).toBe(404);
  });
});
