import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
const context = vi.hoisted(() => ({ workspace: "ws-a", research: "partial" as "partial" | "complete" }));
vi.mock("../src/lib/auth", async () => {
  const actual = await vi.importActual<typeof import("../src/lib/auth")>("../src/lib/auth");
  return { ...actual, requireIdentity: async () => ({ id: "u", email: "u@example.test", name: "User", workspace_id: context.workspace }) };
});
vi.mock("../src/lib/analytics", () => ({ analytics: async () => ({ sessions: 2 }) }));
vi.mock("../src/lib/research-jobs", () => ({ researchJob: async () => ({ id: "run-1", status: context.research, coverage: [{ source: "AI research agent", status: "disconnected", detail: "Connect Anthropic and configure a model." }] }) }));
vi.mock("../src/lib/game-manifest", () => ({ readGameManifest: async () => ({ status: "unavailable", detail: "Unavailable" }) }));
vi.mock("../src/lib/metadata", () => ({ gameMetadata: async () => ({ url: "https://game.example/", title: "Original page title", description: "Page description", image: "", genre: "Cards" as const, metadataStatus: "Forever manifest", manifestSource: { url: "https://game.example/forever.json", observedAt: "2026-01-01T00:00:00Z", sha256: "abc", formatVersion: 1 as const } }) }));
let db: typeof import("../src/lib/db");
let profile: typeof import("../src/lib/game-profile");
let routes: typeof import("../src/app/api/games/[id]/profile/route");
beforeAll(async () => {
  delete process.env.DATABASE_URL; delete process.env.VERCEL; process.env.LOCAL_DATABASE_PATH = "memory://";
  db = await import("../src/lib/db"); profile = await import("../src/lib/game-profile"); routes = await import("../src/app/api/games/[id]/profile/route");
});
beforeEach(async () => { context.workspace = "ws-a"; await db.query("DELETE FROM jobs"); await db.query("DELETE FROM records"); });
const game = { id: "game-1", title: "Owner title", url: "https://game.example/", description: "Owner description", image: "", genre: "Owner genre", sdkKey: "key", origins: [], createdAt: "2026-01-01T00:00:00Z", dailyEnabled: true, competitors: [] };
const metadata = { url: game.url, title: "Original page title", description: "Page description", image: "", genre: "Cards" as const, metadataStatus: "Forever manifest", manifestSource: { url: "https://game.example/forever.json", observedAt: "2026-01-01T00:00:00Z", sha256: "abc", formatVersion: 1 as const } };
const routeContext = { params: Promise.resolve({ id: game.id }) };

describe("game profile investigation", () => {
  it("atomically creates a game and a queued job; isolates data and preserves edits through refresh", async () => {
    const job = await profile.createGameWithProfile("ws-a", game, metadata, "http://localhost:3000");
    expect((await profile.readProfile("ws-a", game.id)).status).toBe("queued");
    await profile.updateProfileOverrides("ws-a", game.id, { description: "Owner description", audience: "Hypothesis: puzzle players" });
    await db.put("ws-a", "recording", { id: "rec-1", gameId: game.id, title: "Play", status: "ready", mode: "jev", createdAt: "2026-01-02T00:00:00Z", observations: [{ at: 4, type: "observation", text: "A menu is visible" }, { at: 5, type: "hypothesis", text: "Invented claim" }] });
    await db.put("ws-b", "recording", { id: "other", gameId: game.id, title: "Other", status: "ready", mode: "jev", createdAt: "2026-01-02T00:00:00Z", observations: [{ at: 1, type: "observation", text: "Private" }] });
    await profile.drainProfile(job);
    const result = await profile.readProfile("ws-a", game.id);
    expect(result.status).toBe("partial");
    expect(result.overrides).toEqual({ description: "Owner description", audience: "Hypothesis: puzzle players" });
    expect(result.facts).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: "page_title", value: "Original page title", evidence: expect.objectContaining({ url: "https://game.example/forever.json", sha256: "abc" }) }),
      expect.objectContaining({ key: "human_sessions", value: "2" }),
      expect.objectContaining({ label: "Gameplay observation", value: "A menu is visible" }),
    ]));
    expect(JSON.stringify(result.facts)).not.toContain("Invented claim");
    expect(JSON.stringify(result.facts)).not.toContain("Private");
    expect(result.prerequisites.join(" ")).toContain("unknown");
    const refreshed = await profile.queueProfile("ws-a", game.id, "http://localhost:3000");
    await profile.drainProfile(refreshed);
    expect((await profile.readProfile("ws-a", game.id)).overrides).toEqual(result.overrides);
    context.workspace = "ws-b";
    expect((await routes.GET(new Request("http://localhost:3000/api/games/game-1/profile"), routeContext)).status).toBe(404);
    expect((await routes.PATCH(new Request("http://localhost:3000/api/games/game-1/profile", { method: "PATCH", headers: { origin: "http://localhost:3000" }, body: JSON.stringify({ overrides: { controls: "private" } }) }), routeContext)).status).toBe(404);
  });
  it("keeps already queued page metadata distinct from validated manifest evidence", async () => {
    const job = await profile.createGameWithProfile("ws-a", game, metadata, "http://localhost:3000");
    const { manifestSource, ...legacy } = metadata;
    await db.query("UPDATE jobs SET body=jsonb_set(body,'{metadata}',$2::jsonb) WHERE id=$1", [job, JSON.stringify({ ...legacy, metadataStatus: "Public page metadata" })]);
    await profile.drainProfile(job);
    const result = await profile.readProfile("ws-a", game.id);
    const fact = result.facts.find(f => f.key === "page_title");
    expect(fact?.evidence).toMatchObject({ source: "Legacy public page metadata", url: game.url });
    expect(fact?.evidence).not.toHaveProperty("sha256");
    expect(fact?.evidence.url).not.toBe(manifestSource.url);
  });
  it("rejects cross-origin edits and merges edits without erasing other fields", async () => {
    await profile.createGameWithProfile("ws-a", game, metadata, "http://localhost:3000");
    await profile.updateProfileOverrides("ws-a", game.id, { audience: "Players", rules: "Collect stars" });
    const rejected = await routes.PATCH(new Request("http://localhost:3000/api/games/game-1/profile", { method: "PATCH", headers: { origin: "https://evil.example" }, body: JSON.stringify({ overrides: { rules: "Wrong" } }) }), routeContext);
    expect(rejected.status).toBe(403);
    const edited = await routes.PATCH(new Request("http://localhost:3000/api/games/game-1/profile", { method: "PATCH", headers: { origin: "http://localhost:3000" }, body: JSON.stringify({ overrides: { rules: "", controls: "Arrow keys" } }) }), routeContext);
    expect(edited.status).toBe(200);
    expect((await edited.json()).overrides).toEqual({ audience: "Players", controls: "Arrow keys" });
  });
  it("rolls back game creation on queue collision and retries expired leases", async () => {
    const job = await profile.createGameWithProfile("ws-a", game, metadata, "http://localhost:3000");
    await db.query("DELETE FROM records WHERE workspace_id='ws-a' AND kind='game'");
    await expect(profile.createGameWithProfile("ws-a", game, metadata, "http://localhost:3000")).rejects.toThrow();
    expect(await db.get("ws-a", "game", game.id)).toBeUndefined();
    await db.put("ws-a", "game", game);
    await db.query("UPDATE jobs SET state='claimed', lease_until=now()-interval '1 second' WHERE id=$1", [job]);
    expect((await profile.readProfile("ws-a", game.id)).status).toBe("queued");
    await profile.drainProfile(job);
    expect((await profile.readProfile("ws-a", game.id)).status).toBe("partial");
  });
});

describe("human-triggered profile refresh", () => {
  it("coalesces accepted human refreshes and keeps owner edits", async () => {
    const initial = await profile.createGameWithProfile("ws-a", game, metadata, "http://localhost:3000");
    await profile.drainProfile(initial);
    await profile.updateProfileOverrides("ws-a", game.id, { controls: "Arrow keys" });
    const queued = await profile.queueHumanProfileRefresh("ws-a", game.id, "http://localhost:3000");
    expect(queued).toBe(initial);
    expect(await profile.queueHumanProfileRefresh("ws-a", game.id, "http://localhost:3000")).toBeUndefined();
    await profile.drainProfile(queued);
    expect((await profile.readProfile("ws-a", game.id)).overrides.controls).toBe("Arrow keys");
    await db.query("UPDATE records SET updated_at=now()-interval '25 hours' WHERE workspace_id='ws-a' AND kind='profile_human_refresh'");
    expect(await profile.queueHumanProfileRefresh("ws-a", game.id, "http://localhost:3000")).toBe(initial);
  });
});
