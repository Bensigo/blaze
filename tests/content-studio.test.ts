import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import ffmpeg from "ffmpeg-static";
import type { Game } from "../src/lib/types";
import { DEFAULT_VIDEO_SETTINGS } from "../src/lib/content-studio-contract";
import type { VideoProduction } from "../src/lib/content-studio-contract";
let db: typeof import("../src/lib/db"); let studio: typeof import("../src/lib/content-studio");
let creds: typeof import("../src/lib/credentials");
const game: Game = { id: "g", title: "Test game", url: "https://game.example/games/test", description: "", genre: "", image: "", sdkKey: "unused", origins: ["https://game.example"], createdAt: "2026-10-30T00:00:00Z", dailyEnabled: false, competitors: [] };
beforeAll(async () => {
  delete process.env.DATABASE_URL; delete process.env.VERCEL; process.env.LOCAL_DATABASE_PATH = "memory://";
  process.env.CREDENTIAL_KEY = Buffer.alloc(32, 17).toString("base64");
  db = await import("../src/lib/db"); studio = await import("../src/lib/content-studio"); creds = await import("../src/lib/credentials");
});
beforeEach(async () => {
  vi.unstubAllGlobals(); delete process.env.BLAZE_CLOUD_PRODUCTION_ENABLED; delete process.env.BLAZE_DAILY_IDEAS_ENABLED;
  delete process.env.BLAZE_CLOUD_WATCHDOG_ENABLED;
  await db.query("DELETE FROM records"); await db.query("DELETE FROM credentials"); await db.query("DELETE FROM jobs");
  await db.put("ws", "game", game);
  await db.put("ws", "game_profile", { id: "g", gameId: "g", result: "complete", lastRefresh: "2026-10-30T00:00:00Z", prerequisites: [], facts: [
    { key: "manifest_description", value: "Move the token along a path.", evidence: { source: "Game manifest", url: "https://game.example/games/test/forever.json", observedAt: "2026-10-30T00:00:00Z" } },
    { key: "manifest_controls", value: "Arrow keys move the token.", evidence: { source: "Game manifest", observedAt: "2026-10-30T00:00:00Z" } },
    { key: "human_sessions", value: "PRIVATE_TELEMETRY", evidence: { source: "Human telemetry" } },
  ] });
});
async function setup() {
  const source = await studio.gameSources("ws", "g");
  await db.put("ws", "connection", { id: "anth", provider: "anthropic", connected: true, label: "Existing Anthropic", model: "test", checkedAt: "2026-10-30T00:00:00Z" });
  await creds.saveSecret("ws", "anth", { token: "test-secret-not-real", model: "test" });
  await db.put("ws", "content_provider", { id: "default", connectionId: "anth", agentId: "agent_test", agentVersion: 1, environmentId: "env_test", revision: "v1", pilotVerified: true, networkPolicyVerified: true, organizationVerified: true, watchdogVerified: true, reviewedGames: { g: { sourceRevision: source.revision, gameAudioVerified: false } } });
  process.env.BLAZE_CLOUD_PRODUCTION_ENABLED = "true";
  process.env.BLAZE_CLOUD_WATCHDOG_ENABLED = "true";
  await db.put("ws", "content_watchdog", { id: "default", configRevision: "v1", checkedAt: new Date().toISOString(), healthy: true, scanned: 0, unresolved: 0 });
  return (await studio.prepareSourceIdeas("ws", "g"))[0];
}
const approve = (ideaId: string, requestId = randomUUID(), settings = DEFAULT_VIDEO_SETTINGS) => studio.approveVideo("ws", "owner", { ideaId, settings, maxListCostCents: 100, requestId });
describe("content studio approvals and recovery", () => {
  it("prepares scoped source outlines once without model calls or private telemetry", async () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    const first = await studio.prepareSourceIdeas("ws", "g"); await studio.prepareSourceIdeas("ws", "g");
    expect(first).toHaveLength(3); expect(await db.list("ws", "content_idea")).toHaveLength(3);
    expect(JSON.stringify(await studio.gameSources("ws", "g"))).not.toContain("PRIVATE_TELEMETRY");
    expect((await studio.studioSnapshot("other")).ideas).toEqual([]);
    await expect(studio.prepareSourceIdeas("other", "g")).rejects.toThrow("Game not found");
    expect(fetch).not.toHaveBeenCalled();
  });
  it("keeps generation and recurrence paused without setup; saving a time does not enable spend", async () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    const idea = (await studio.prepareSourceIdeas("ws", "g"))[0];
    await expect(approve(idea.id)).rejects.toThrow("Anthropic");
    expect((await studio.saveIdeaSchedule("ws", { countPerGame: 2, localTime: "08:15", maxOutputTokensPerGame: 1500 })).enabled).toBe(false);
    const { runDailyIdeas } = await import("../src/lib/daily-content-ideas");
    expect(await runDailyIdeas("ws")).toMatchObject({ paused: true });
    expect(await db.list("ws", "video_production")).toEqual([]); expect(fetch).not.toHaveBeenCalled();
  });
  it("serializes repeated approvals across different tabs and rejects changed settings", async () => {
    const idea = await setup(); const requestId = randomUUID();
    const a = await approve(idea.id, requestId); const b = await approve(idea.id, requestId); const c = await approve(idea.id);
    expect(a.id).toBe(b.id); expect(c.id).toBe(a.id); expect(await db.list("ws", "video_production")).toHaveLength(1);
    await expect(approve(idea.id, randomUUID(), { ...DEFAULT_VIDEO_SETTINGS, durationSeconds: 20 })).rejects.toThrow("active run");
    await expect(approve(idea.id, requestId, { ...DEFAULT_VIDEO_SETTINGS, durationSeconds: 20 })).rejects.toThrow("different settings");
  });
  it("makes one session create for repeated clicks and never retries uncertain starts", async () => {
    const idea = await setup(); const production = await approve(idea.id);
    const fetch = vi.fn(async () => { throw new Error("connection lost after provider accepted"); }); vi.stubGlobal("fetch", fetch);
    await Promise.all([studio.startApprovedVideo("ws", production.id), studio.startApprovedVideo("ws", production.id)]);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(await db.get("ws", "video_production", production.id)).toMatchObject({ state: "needs_reconciliation" });
    await studio.startApprovedVideo("ws", production.id); expect(fetch).toHaveBeenCalledTimes(1);
    await expect(approve(idea.id, randomUUID(), { ...DEFAULT_VIDEO_SETTINGS, durationSeconds: 15 })).rejects.toThrow("active run");
  });
  it("rejects expired approvals, changed keys, unverified game audio and cross-workspace IDs before dispatch", async () => {
    const idea = await setup();
    await expect(approve(idea.id, randomUUID(), { ...DEFAULT_VIDEO_SETTINGS, gameAudio: true })).rejects.toThrow("verified pilot");
    const production = await approve(idea.id); const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    await expect(studio.startApprovedVideo("other", production.id)).rejects.toThrow("Video not found");
    await creds.saveSecret("ws", "anth", { token: "changed-test-secret", model: "test" });
    await expect(studio.startApprovedVideo("ws", production.id)).rejects.toThrow("key changed");
    await db.put("ws", "video_production", { ...production, expiresAt: "2020-01-01T00:00:00Z" });
    expect(await studio.startApprovedVideo("ws", production.id)).toMatchObject({ state: "failed" }); expect(fetch).not.toHaveBeenCalled();
  });
  it("cancels before dispatch and preserves a cancellation racing session creation", async () => {
    const idea = await setup(); const production = await approve(idea.id);
    expect(await studio.cancelVideo("ws", production.id)).toMatchObject({ state: "cancelled" });
    const next = await approve(idea.id);
    const fetch = vi.fn(async (url: RequestInfo | URL) => {
      if (String(url).endsWith("/sessions")) { await studio.cancelVideo("ws", next.id); return Response.json({ id: "sesn_test", status: "running" }); }
      return Response.json({ data: [] });
    }); vi.stubGlobal("fetch", fetch);
    expect(await studio.startApprovedVideo("ws", next.id)).toMatchObject({ state: "cancel_requested", sessionId: "sesn_test" });
    expect(fetch).toHaveBeenCalledTimes(2);
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ id: "sesn_test", status: "idle" })));
    expect(await studio.refreshVideo("ws", next.id)).toMatchObject({ state: "cancelled" });
  });
  it("recovers an interrupted start without creating another paid session", async () => {
    const idea = await setup(); const production = await approve(idea.id);
    await db.put("ws", "video_production", { ...production, state: "starting", updatedAt: "2020-01-01T00:00:00Z" });
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    expect(await studio.refreshVideo("ws", production.id)).toMatchObject({ state: "needs_reconciliation" }); expect(fetch).not.toHaveBeenCalled();
  });
  it("reads reported provider usage without treating list cost as a settled bill", async () => {
    const idea = await setup(); const production = await approve(idea.id);
    await db.put("ws", "video_production", { ...production, state: "running", sessionId: "sesn_test" });
    const fetch = vi.fn(async () => Response.json({ id: "sesn_test", status: "running", usage: { input_tokens: 40, output_tokens: 80, list_cost: { amount: "12", currency: "USD" } } })); vi.stubGlobal("fetch", fetch);
    expect(await studio.refreshVideo("ws", production.id)).toMatchObject({ state: "running", usage: { listCostCents: "12", inputTokens: 40, outputTokens: 80, status: "reported_unsettled" } });
    expect(fetch).toHaveBeenCalledOnce();
  });
  it("imports session-scoped MP4 and gameplay report into private storage without another paid call", async () => {
    const idea = await setup();
    const settings = { ...DEFAULT_VIDEO_SETTINGS, durationSeconds: 10, music: "none" as const };
    const production = await approve(idea.id, randomUUID(), settings);
    await db.put("ws", "video_production", { ...production, state: "running", sessionId: "sesn_test" });
    const encoded = spawnSync(ffmpeg!, ["-v", "error", "-f", "lavfi", "-i", "color=blue:s=360x640:r=15:d=10", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-movflags", "frag_keyframe+empty_moov", "-f", "mp4", "pipe:1"], { maxBuffer: 4 * 1024 * 1024 });
    if (encoded.status !== 0) throw new Error(encoded.stderr.toString());
    const report = Buffer.from(JSON.stringify({ gameUrl: game.url, durationSeconds: 10, playedActions: [{ at: 1, action: "Fixture-reported action" }], rawCaptureFilename: "raw.webm", audioCaptured: false, limitations: ["Synthetic parser fixture, not proof of cloud gameplay."] }));
    const fetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.method || "GET").toBe("GET");
      if (String(url).includes("/sessions/")) return Response.json({ id: "sesn_test", status: "idle" });
      if (String(url).includes("/files?scope_id=sesn_test")) return Response.json({ data: [{ id: "file_video", filename: "video.mp4", size_bytes: encoded.stdout.length }, { id: "file_report", filename: "evidence.json", size_bytes: report.length }, { id: "file_raw", filename: "raw.webm", size_bytes: 2000 }], next_page: null });
      if (String(url).endsWith("/file_report/content")) return new Response(report);
      if (String(url).endsWith("/file_video/content")) return new Response(encoded.stdout);
      throw new Error("Unexpected request");
    }); vi.stubGlobal("fetch", fetch);
    const result = await studio.refreshVideo("ws", production.id);
    try {
      expect(result).toMatchObject({ state: "ready", videoUrl: expect.stringMatching(/^\/api\/media\/media_/) });
      expect(await db.get("ws", "production_evidence", production.id)).toMatchObject({ verification: expect.stringContaining("agent-reported") });
      expect(await db.list("other", "media")).toEqual([]);
      const { mediaRecord, serveMedia } = await import("../src/lib/media");
      const media = await mediaRecord("ws", result.videoUrl!.split("/").at(-1)!);
      const response = await serveMedia(media!, new Request("http://localhost/api/media/test", { headers: { range: "bytes=0-15" } }));
      expect(response.status).toBe(206); expect((await response.arrayBuffer()).byteLength).toBe(16);
      await studio.refreshVideo("ws", production.id); expect(fetch).toHaveBeenCalledTimes(4);
    } finally { if (result.videoUrl) await (await import("../src/lib/media")).deleteAsset("ws", result.videoUrl); }
  });
  it("validates exact Dubai dates and owned ready media without creating a publishing job", async () => {
    const idea = await setup(); const production = await approve(idea.id);
    await expect(studio.planVideo("ws", production.id, "2026-11-01")).rejects.toThrow("Finish the video");
    await db.put("ws", "video_production", { ...production, state: "ready", videoUrl: "/api/media/media_test" });
    await db.put("ws", "media", { id: "media_test", recordingId: production.id, contentType: "video/mp4" });
    await expect(studio.planVideo("ws", production.id, "2026-02-30")).rejects.toThrow("valid calendar date");
    expect(await studio.planVideo("ws", production.id, "2026-11-01")).toMatchObject({ plannedDate: "2026-11-01", planningTimeZone: "Asia/Dubai", state: "ready" });
    expect(await db.list("ws", "post")).toEqual([]); expect(await db.query("SELECT id FROM jobs")).toEqual([]);
    await expect(studio.planVideo("other", production.id, "2026-11-01")).rejects.toThrow("Video not found");
  });
  it("uses Dubai's date boundary", () => { expect(studio.dubaiDate(new Date("2026-10-30T20:01:00Z"))).toBe("2026-10-31"); });
});
