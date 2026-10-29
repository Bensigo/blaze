import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ jev: true, anth: false, profile: true }));
vi.mock("../src/lib/credentials", () => ({ secretFor: async (_workspace: string, provider: string) => provider === "jev" && state.jev ? { token: "test-jevs", model: "typesafe/jev-1.13", jevConnectionId: "jev", jevSettingsRevision: "rev", jevCredentialVersion: "cred" } : provider === "anthropic" && state.anth ? { token: "test-anth", model: "test-model" } : undefined }));
vi.mock("../src/lib/ai-settings", () => ({ verifyJevModel: async () => {}, resolveAISecret: async (_workspace: string, live?: boolean) => { if (live !== false || !state.anth) throw new Error("unavailable"); return { token: "test-anth", model: "test-model", aiProvider: "anthropic", aiConnectionId: "anth", aiSettingsRevision: "rev", aiCredentialVersion: "cred" }; } }));
vi.mock("../src/lib/game-profile", () => ({ readProfile: async () => ({ status: state.profile ? "partial" : "queued", lastRefresh: state.profile ? "2026-01-01T00:00:00Z" : null }), drainProfile: async () => {} }));
let db: typeof import("../src/lib/db");
let automation: typeof import("../src/lib/game-automation");
let jobs: typeof import("../src/lib/jobs");
beforeAll(async () => { delete process.env.DATABASE_URL; delete process.env.VERCEL; process.env.LOCAL_DATABASE_PATH = "memory://"; db = await import("../src/lib/db"); automation = await import("../src/lib/game-automation"); jobs = await import("../src/lib/jobs"); }, 30000);
beforeEach(async () => { state.jev = true; state.anth = false; state.profile = true; await db.query("DELETE FROM records"); await db.query("DELETE FROM jobs"); });
const game = { id: "game-a", title: "Actual game", url: "https://game.example/", description: "", image: "", genre: "", sdkKey: "key", origins: [], createdAt: "2026-01-01T00:00:00Z", dailyEnabled: true, competitors: [] };
const rec = { id: "rec-real", gameId: game.id, title: "Jev", mode: "jev" as const, status: "ready" as const, createdAt: "2026-01-01T00:00:00Z", videoUrl: "/api/media/media_real", duration: 25, actions: [{ id: "left", at: 3 }], observations: [{ at: 10, text: "Observed 1 actions and 1 Jev model decisions.", type: "observation" as const }] };
async function ready() {
  await db.put("ws", "game", game);
  await db.put("ws", "connection", { id: "jev", provider: "openrouter", label: "Jev", connected: true, checkedAt: "2026-01-01T00:00:00Z" });
  await db.put("ws", "recording", rec);
  await db.put("ws", "media", { id: "media_real", recordingId: rec.id, kind: "video", size: 100, contentType: "video/webm", backend: "local", location: "private", createdAt: rec.createdAt });
  await db.query(`INSERT INTO jobs(id,workspace_id,kind,state,body) VALUES('worker-runtime','system','worker_heartbeat','active','{}')`);
}
describe("automatic Jev recording and clip candidates", () => {
  it("requires verified same-game model decisions, provider, worker, and investigated profile", async () => {
    await ready();
    let result = await automation.automationState("ws", game.id);
    expect(result.ready).toBe(true); expect(result.adapterVerified).toBe(true); expect(result.draftReady).toBe(false);
    await db.put("ws", "recording", { ...rec, observations: [{ at: 1, text: "Observed 1 actions and 0 Jev model decisions.", type: "observation" }] });
    await db.put("ws", "recording", { ...rec, id: "fixture", mode: "fixture", videoUrl: "/api/media/media_real" });
    result = await automation.automationState("ws", game.id);
    expect(result.adapterVerified).toBe(false); expect(result.reasons.join(" ")).toContain("model decision");
    state.jev = false; state.profile = false;
    await db.query("UPDATE jobs SET updated_at=now()-interval '2 minutes' WHERE id='worker-runtime'");
    result = await automation.automationState("ws", game.id);
    expect(result.ready).toBe(false); expect(result.reasons.join(" ")).toContain("Jev key"); expect(result.reasons.join(" ")).toContain("heartbeat"); expect(result.reasons.join(" ")).toContain("investigation");
    expect((await automation.queueScheduledRecording("ws", game)).queued).toBe(false);
  });
  it("queues only one recording across repeated or simultaneous ticks and enforces the interval", async () => {
    await ready();
    const results = await Promise.all([automation.queueScheduledRecording("ws", game), automation.queueScheduledRecording("ws", game)]);
    expect(results.filter(r => r.queued)).toHaveLength(1);
    expect(await db.query("SELECT id FROM jobs WHERE kind='recording' AND state='queued'")).toHaveLength(1);
    const manual = { ...rec, id: "manual-new", status: "queued" as const };
    await expect(jobs.enqueue("ws", "recording", manual)).rejects.toThrow("already active");
    const active = (await automation.automationState("ws", game.id)).activeRecordingId!;
    await db.query("UPDATE jobs SET state='complete' WHERE id=$1", [active]);
    await automation.releaseRecordingGate("ws", game.id, active);
    expect((await automation.queueScheduledRecording("ws", game)).queued).toBe(false);
    await automation.setAutomationConfig("ws", game.id, { enabled: false, intervalHours: 6 });
    const paused = await automation.automationState("ws", game.id);
    expect(paused.enabled).toBe(false); expect(paused.intervalHours).toBe(6); expect(paused.ready).toBe(false);
  });
  it("creates exactly one bounded candidate only for real, owned Jev footage", async () => {
    await ready();
    expect(await automation.queueClipCandidate("ws", { ...rec, mode: "fixture" }, game.title)).toBe(false);
    expect(await automation.queueClipCandidate("ws", { ...rec, status: "failed" }, game.title)).toBe(false);
    expect(await automation.queueClipCandidate("ws", { ...rec, actions: [] }, game.title)).toBe(false);
    expect(await automation.queueClipCandidate("other-ws", rec, game.title)).toBe(false);
    expect(await automation.queueClipCandidate("ws", rec, game.title)).toBe(true);
    expect(await automation.queueClipCandidate("ws", rec, game.title)).toBe(false);
    const clip = (await db.query<{body:{start:number;end:number;recordingId:string}}>("SELECT body FROM records WHERE workspace_id='ws' AND kind='clip'"))[0].body;
    expect(clip.recordingId).toBe(rec.id); expect(clip.start).toBe(2); expect(clip.end).toBeLessThanOrEqual(rec.duration); expect(clip.end - clip.start).toBeLessThanOrEqual(20);
  });
});

describe("bounded content recovery", () => {
  it("wraps a finite snapshot even if new recordings keep arriving", async () => {
    for (let i = 0; i < 11; i++) {
      const id = `old-${String(i).padStart(2, "0")}`, media = `media_old${String(i).padStart(2, "0")}`;
      await db.put("ws", "recording", { ...rec, id, videoUrl: `/api/media/${media}` });
      if (i !== 0) await db.put("ws", "media", { id: media, recordingId: id, kind: "video" });
    }
    await db.query(`UPDATE records SET updated_at='2026-01-01T00:00:00.123456Z'::timestamptz WHERE workspace_id='ws' AND kind='recording'`);
    await automation.recoverGameContent("ws", game);
    expect(await db.query(`SELECT id FROM jobs WHERE workspace_id='ws' AND kind='clip'`)).toHaveLength(9);
    for (let i = 0; i < 11; i++) {
      const id = `new-${String(i).padStart(2, "0")}`, media = `media_new${String(i).padStart(2, "0")}`;
      await db.put("ws", "recording", { ...rec, id, videoUrl: `/api/media/${media}` });
      await db.put("ws", "media", { id: media, recordingId: id, kind: "video" });
    }
    // Newer arrivals do not extend the current cycle; the one old row is the final page.
    await automation.recoverGameContent("ws", game);
    const cursor = await db.get<{ id: string; recording?: unknown }>("ws", "automation_recovery", game.id);
    expect(cursor?.recording).toBeUndefined();
    expect(await db.query(`SELECT id FROM jobs WHERE workspace_id='ws' AND kind='clip'`)).toHaveLength(10);
    await db.put("ws", "media", { id: "media_old00", recordingId: "old-00", kind: "video" });
    await automation.recoverGameContent("ws", game);
    expect(await db.query(`SELECT id FROM jobs WHERE workspace_id='ws' AND kind='clip'`)).toHaveLength(11);
  }, 60000);
  it("walks beyond the first recording and clip pages, wraps for restored prerequisites, and never duplicates or retries failed jobs", async () => {
    await ready();
    await automation.setAutomationConfig("ws", game.id, { enabled: false });
    await db.put("ws", "connection", { id: "anth", provider: "anthropic", label: "Anthropic", connected: false, checkedAt: "2026-01-01T00:00:00Z", model: "test-model" });
    const all = [rec];
    for (let i = 0; i < 12; i++) {
      const id = `rec-extra-${String(i).padStart(2, "0")}`;
      const mediaId = `media_extra${String(i).padStart(2, "0")}`;
      const recording = { ...rec, id, videoUrl: `/api/media/${mediaId}` };
      all.push(recording);
      await db.put("ws", "recording", recording);
      // The first extra recording's asset arrives after the first scan.
      if (i !== 0) await db.put("ws", "media", { id: mediaId, recordingId: id, kind: "video", contentType: "video/webm" });
    }
    for (let i = 0; i < all.length; i++) {
      const recording = all[i], id = `ready-${String(i).padStart(2, "0")}`, mediaId = `media_clip${String(i).padStart(2, "0")}`;
      await db.put("ws", "clip", { id, gameId: game.id, recordingId: recording.id, title: "Ready clip", status: "ready", layout: "landscape", start: 0, end: 10, createdAt: rec.createdAt, videoUrl: `/api/media/${mediaId}` });
      if (i !== 1) await db.put("ws", "media", { id: mediaId, recordingId: recording.id, clipId: id, kind: "clip", contentType: "video/mp4" });
    }
    // Identical microsecond timestamps force the keyset to use the id tie-breaker.
    await db.query(`UPDATE records SET updated_at='2026-01-01T00:00:00.123456Z'::timestamptz WHERE workspace_id='ws' AND kind IN ('recording','clip')`);
    await db.put("other-ws", "recording", { ...rec, id: "foreign-recording" });
    const tick = async () => {
      await db.query(`UPDATE jobs SET lease_until=now()-interval '1 second' WHERE id='automation-tick'`);
      await automation.tickAutomation();
    };
    // One-game scheduler alternates processing the game and wrapping its global cursor.
    await tick(); await tick(); await tick();
    expect(await db.query(`SELECT id FROM jobs WHERE workspace_id='ws' AND kind='clip'`)).toHaveLength(12);
    expect(await db.query(`SELECT id FROM jobs WHERE kind='content_draft'`)).toHaveLength(0);
    expect(await db.query(`SELECT id FROM jobs WHERE workspace_id='other-ws'`)).toHaveLength(0);
    const cursor = await db.get<{ id: string; recording?: unknown; clip?: unknown }>("ws", "automation_recovery", game.id);
    expect(cursor?.recording).toBeUndefined(); expect(cursor?.clip).toBeUndefined();
    // Restoring the provider and both missing media makes old entries eligible on wrap.
    state.anth = true;
    await db.put("ws", "connection", { id: "anth", provider: "anthropic", label: "Anthropic", connected: true, checkedAt: "2026-01-01T00:00:00Z", model: "test-model" });
    await db.put("ws", "media", { id: "media_extra00", recordingId: "rec-extra-00", kind: "video", contentType: "video/webm" });
    await db.put("ws", "media", { id: "media_clip01", recordingId: "rec-extra-00", clipId: "ready-01", kind: "clip", contentType: "video/mp4" });
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    try {
      await tick(); await tick(); await tick(); await tick();
      expect(await db.query(`SELECT id FROM jobs WHERE workspace_id='ws' AND kind='clip'`)).toHaveLength(13);
      const drafts = await db.query<{ id: string; state: string }>(`SELECT id,state FROM jobs WHERE workspace_id='ws' AND kind='content_draft' ORDER BY id`);
      expect(drafts).toHaveLength(13);
      await db.query(`UPDATE jobs SET state='failed' WHERE id=$1`, [drafts[0].id]);
      // Several complete wraps must leave the stable failed job failed, not enqueue paid retries.
      for (let i = 0; i < 6; i++) await tick();
      const after = await db.query<{ id: string; state: string }>(`SELECT id,state FROM jobs WHERE workspace_id='ws' AND kind='content_draft' ORDER BY id`);
      expect(after).toHaveLength(13); expect(after.find(j => j.id === drafts[0].id)?.state).toBe("failed");
      expect(fetchMock).not.toHaveBeenCalled();
    } finally { vi.unstubAllGlobals(); }
  }, 60000);
});
