import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
const catalogState = vi.hoisted(() => ({ compatible: true }));
vi.mock("../src/lib/ai-model-catalog", () => ({ discoverAIModels: async (provider: string) => ({ provider, models: [{ id: "test", name: "test", compatible: catalogState.compatible, supportsTools: true, supportsStructuredOutput: true }], fetchedAt: "", source: "fixture" }) }));
import type { Clip, Game, Recording } from "../src/lib/types";
let db: typeof import("../src/lib/db");
let automation: typeof import("../src/lib/content-automation");
let credentials: typeof import("../src/lib/credentials");
const game: Game = { id: "g", title: "Game", url: "https://game.example/", description: "", image: "", genre: "", sdkKey: "key", origins: [], createdAt: new Date().toISOString(), dailyEnabled: false, competitors: [] };
const recording: Recording = { id: "r", gameId: "g", title: "run", status: "ready", mode: "jev", duration: 20, createdAt: new Date().toISOString(), videoUrl: "/api/media/media_real", actions: [{ id: "go", at: 1 }], observations: [{ type: "observation", at: 5, text: "Observed 1 actions and 1 Jev model decisions." }] };
const clip: Clip = { id: "c", gameId: "g", recordingId: "r", title: "Clip", start: 0, end: 10, layout: "landscape", status: "ready", videoUrl: "/api/media/media_clip", createdAt: new Date().toISOString() };
beforeAll(async () => { delete process.env.DATABASE_URL; delete process.env.VERCEL; process.env.LOCAL_DATABASE_PATH = "memory://"; process.env.CREDENTIALS_ENCRYPTION_KEY = "01234567890123456789012345678901"; db = await import("../src/lib/db"); automation = await import("../src/lib/content-automation"); credentials = await import("../src/lib/credentials"); });
beforeEach(async () => {
  catalogState.compatible = true;
  await db.query("DELETE FROM jobs"); await db.query("DELETE FROM records"); await db.query("DELETE FROM credentials"); await db.query("DELETE FROM events");
  await db.put("ws", "game", game); await db.put("ws", "recording", recording); await db.put("ws", "clip", clip);
  await db.put("ws", "media", { id: "media_real", recordingId: "r", kind: "video" }); await db.put("ws", "media", { id: "media_clip", recordingId: "r", clipId: "c", kind: "clip", contentType: "video/mp4" });
});
async function connect() {
  await db.put("ws", "connection", { id: "anth", provider: "anthropic", connected: true, checkedAt: new Date().toISOString(), model: "test" });
  await credentials.saveSecret("ws", "anth", { token: "test", model: "test" });
}
describe("automatic clip draft", () => {
  it("uses one real SDK request and creates one unapproved manual calendar draft", async () => {
    await connect();
    await db.put("ws", "game_profile_overrides", { id: "g", overrides: { controls: "Use arrows" } });
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({ id: "msg", type: "message", role: "assistant", model: "test", content: [{ type: "text", text: "Play the game" }], stop_reason: "end_turn", stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } }), { headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    try {
      expect(await automation.queueClipDraft("ws", clip)).toBe(true);
      expect(await automation.queueClipDraft("ws", clip)).toBe(false);
      await automation.drainContentAutomation(); await automation.drainContentAutomation();
      const posts = await db.list<import("../src/lib/types").Post>("ws", "post");
      expect(posts).toHaveLength(1); expect(posts[0]).toMatchObject({ status: "draft", deliveryMethod: "manual", accountId: "", text: "Play the game", channel: "youtube" });
      expect(posts[0].scheduledAt).toBeTruthy(); expect(posts[0].approvedHash).toBeUndefined(); expect(posts[0].publicationUrl).toBeUndefined();
      expect(fetchMock).toHaveBeenCalledTimes(1); expect(String(fetchMock.mock.calls[0][1]?.body)).toContain("Use arrows");
    } finally { vi.unstubAllGlobals(); }
  });
  it("waits for verified credentials, rejects fixtures and forced-only runs, and never auto-retries model failure", async () => {
    expect(await automation.queueClipDraft("ws", clip)).toBe(false);
    expect(await db.query("SELECT id FROM jobs WHERE kind='content_draft'")).toHaveLength(0);
    await connect();
    await db.put("ws", "recording", { ...recording, mode: "fixture" }); expect(await automation.queueClipDraft("ws", clip)).toBe(false);
    await db.put("ws", "recording", { ...recording, observations: [{ type: "observation", at: 1, text: "Observed 1 actions and 0 Jev model decisions." }] }); expect(await automation.queueClipDraft("ws", clip)).toBe(false);
    await db.put("ws", "recording", recording); expect(await automation.queueClipDraft("ws", clip)).toBe(true);
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("provider failed"); }));
    try { await automation.drainContentAutomation(); await automation.drainContentAutomation(); } finally { vi.unstubAllGlobals(); }
    const posts = await db.list<import("../src/lib/types").Post>("ws", "post"); expect(posts).toHaveLength(1); expect(posts[0]).toMatchObject({ status: "failed", deliveryMethod: "manual" }); expect(posts[0].error).toContain("Account settings");
    expect(await automation.queueClipDraft("ws", clip)).toBe(false);
  });
  it("pins selection and fails changed or legacy unpinned jobs without a model request", async () => {
    await connect();
    expect(await automation.queueClipDraft("ws", clip)).toBe(true);
    const job = (await db.query<{body:{ai:unknown}}>("SELECT body FROM jobs WHERE kind='content_draft'"))[0];
    expect(job.body.ai).toMatchObject({ provider: "anthropic", model: "test", connectionId: "anth", settingsRevision: expect.any(String), credentialVersion: expect.any(String) });
    await db.put("ws", "connection", { id: "other", provider: "anthropic", connected: true, checkedAt: new Date().toISOString(), model: "test" });
    await credentials.saveSecret("ws", "other", { token: "different", model: "test" });
    await db.put("ws", "ai_settings", { id: "default", provider: "anthropic", model: "test", connectionId: "other", validatedAt: new Date().toISOString() });
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    try {
      await automation.drainContentAutomation();
      const posts = await db.list<import("../src/lib/types").Post>("ws", "post");
      expect(posts[0]).toMatchObject({ status: "failed", error: expect.stringContaining("changed") });
      expect(fetchMock).not.toHaveBeenCalled();
      await db.query("DELETE FROM jobs WHERE kind='content_draft'"); await db.query("DELETE FROM records WHERE kind='post'");
      await db.query("INSERT INTO jobs(id,workspace_id,kind,state,body) VALUES('old','ws','content_draft','queued',$1::jsonb)", [JSON.stringify({ gameId: 'g', clipId: 'c' })]);
      await automation.drainContentAutomation();
      expect((await db.list<import("../src/lib/types").Post>("ws", "post"))[0]).toMatchObject({ status: "failed", error: expect.stringContaining("no AI selection") });
      expect(fetchMock).not.toHaveBeenCalled();
    } finally { vi.unstubAllGlobals(); }
  });
  it("does not run a queued draft after the same connection key is replaced", async () => {
    await connect(); expect(await automation.queueClipDraft("ws", clip)).toBe(true);
    await credentials.saveSecret("ws", "anth", { token: "rotated", model: "test" });
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    try {
      await automation.drainContentAutomation();
      expect((await db.list<import("../src/lib/types").Post>("ws", "post"))[0]).toMatchObject({ status: "failed", error: expect.stringContaining("changed") });
      expect(fetchMock).not.toHaveBeenCalled();
    } finally { vi.unstubAllGlobals(); }
  });
  it("validates availability again before a paid request", async () => {
    await connect();
    expect(await automation.queueClipDraft("ws", clip)).toBe(true);
    catalogState.compatible = false;
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    try {
      await automation.drainContentAutomation();
      expect((await db.list<import("../src/lib/types").Post>("ws", "post"))[0]).toMatchObject({ status: "failed", error: expect.stringContaining("Account settings") });
      expect(fetchMock).not.toHaveBeenCalled();
    } finally { vi.unstubAllGlobals(); }
  });
  it("surfaces an expired model lease without retrying the request", async () => {
    await connect();
    await automation.queueClipDraft("ws", clip);
    await db.query("UPDATE jobs SET state='claimed',lease_until=now()-interval '1 second' WHERE kind='content_draft'");
    await automation.drainContentAutomation();
    const posts = await db.list<import("../src/lib/types").Post>("ws", "post");
    expect(posts).toHaveLength(1); expect(posts[0].status).toBe("failed"); expect(posts[0].error).toContain("interrupted");
    expect(await automation.queueClipDraft("ws", clip)).toBe(false);
  });
});
