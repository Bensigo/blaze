import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { hash } from "../src/lib/security";
import type { VideoProduction } from "../src/lib/content-studio-contract";
import { DEFAULT_VIDEO_SETTINGS } from "../src/lib/content-studio-contract";
let db: typeof import("../src/lib/db"); let watchdog: typeof import("../src/lib/content-production-watchdog");
const now = Date.now();
beforeAll(async () => {
  delete process.env.DATABASE_URL; delete process.env.VERCEL; process.env.LOCAL_DATABASE_PATH = "memory://";
  process.env.CREDENTIAL_KEY = Buffer.alloc(32, 17).toString("base64");
  db = await import("../src/lib/db"); watchdog = await import("../src/lib/content-production-watchdog");
});
beforeEach(async () => {
  vi.unstubAllGlobals(); delete process.env.BLAZE_CLOUD_WATCHDOG_ENABLED;
  await db.query("DELETE FROM records"); await db.query("DELETE FROM jobs"); await db.query("DELETE FROM credentials");
  await db.put("ws", "connection", { id: "anth", provider: "anthropic", connected: true, label: "Fixture key" });
  await (await import("../src/lib/credentials")).saveSecret("ws", "anth", { token: "not-a-real-secret" });
  await db.put("ws", "content_provider", { id: "default", connectionId: "anth", revision: "v1", watchdogVerified: true });
});
async function production(id = "p", started = now - 31 * 60000, extra: Partial<VideoProduction> = {}) {
  const encrypted = (await db.query<{ encrypted: string }>("SELECT encrypted FROM credentials WHERE workspace_id='ws' AND provider='anth'"))[0].encrypted;
  const value: VideoProduction = { id, gameId: "g", ideaId: "idea", idea: { id: "idea", gameId: "g", title: "Fixture", hook: "", treatment: "", shots: [], factKeys: [], sourceRevision: "source", createdAt: new Date(started).toISOString(), origin: "source_outline", fingerprint: "fixture" },
    settings: DEFAULT_VIDEO_SETTINGS, state: "running", approvedBy: "owner", approvedAt: new Date(started).toISOString(), expiresAt: new Date(now + 10000).toISOString(), approvalHash: "approval", sourceRevision: "source", maxListCostCents: 100, providerRevision: "v1", credentialRevision: hash(encrypted), sessionId: `sesn_${id}`,
    createdAt: new Date(started).toISOString(), updatedAt: new Date(started).toISOString(), startedAt: new Date(started).toISOString(), watchdogDeadlineAt: new Date(started + watchdog.PRODUCTION_RUNTIME_MS).toISOString(), ...extra };
  await db.put("ws", "video_production", value); return value;
}
describe("durable production runtime watchdog", () => {
  it("is default-off and a saved verification flag cannot replace a fresh heartbeat", async () => {
    await production(); const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    expect(await watchdog.tickProductionWatchdog("ws", now)).toEqual({ paused: true }); expect(await watchdog.watchdogReady("ws", "v1", now)).toBe(false);
    process.env.BLAZE_CLOUD_WATCHDOG_ENABLED = "true";
    await db.put("ws", "content_watchdog", { id: "default", configRevision: "v1", checkedAt: new Date(now - 91000).toISOString(), healthy: true });
    expect(await watchdog.watchdogReady("ws", "v1", now)).toBe(false);
    await db.put("ws", "content_watchdog", { id: "default", configRevision: "v1", checkedAt: new Date(now).toISOString(), healthy: true });
    expect(await watchdog.watchdogReady("ws", "v1", now)).toBe(true); expect(await watchdog.watchdogReady("ws", "v2", now)).toBe(false); expect(fetch).not.toHaveBeenCalled();
  });
  it("does not contact the provider before the immutable deadline", async () => {
    process.env.BLAZE_CLOUD_WATCHDOG_ENABLED = "true"; await production("p", now - 5 * 60000);
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    expect(await watchdog.tickProductionWatchdog("ws", now)).toMatchObject({ healthy: true, scanned: 0 }); expect(fetch).not.toHaveBeenCalled();
  });
  it("requests one interrupt at the deadline, blocks new starts, and confirms idle on a later tick", async () => {
    process.env.BLAZE_CLOUD_WATCHDOG_ENABLED = "true"; await production(); let idle = false;
    const fetch = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => init?.method === "POST" ? Response.json({ data: [] }) : Response.json({ id: "sesn_p", status: idle ? "idle" : "running" })); vi.stubGlobal("fetch", fetch);
    expect(await watchdog.tickProductionWatchdog("ws", now)).toMatchObject({ healthy: false, unresolved: 1 });
    expect(await db.get("ws", "video_production", "p")).toMatchObject({ state: "cancel_requested", stopRequest: { state: "requested", reason: "runtime_limit" } });
    expect(await watchdog.watchdogReady("ws", "v1", now)).toBe(false);
    await watchdog.tickProductionWatchdog("ws", now + 1000);
    expect(fetch.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
    idle = true; expect(await watchdog.tickProductionWatchdog("ws", now + 2000)).toMatchObject({ healthy: true, unresolved: 0 });
    expect(await db.get("ws", "video_production", "p")).toMatchObject({ state: "cancelled", stoppedAt: new Date(now + 2000).toISOString(), stopRequest: { state: "confirmed" } });
    const post = fetch.mock.calls.find(([, init]) => init?.method === "POST")!;
    expect(String(post[0])).toBe("https://api.anthropic.com/v1/sessions/sesn_p/events"); expect(JSON.parse(String(post[1]?.body))).toEqual({ events: [{ type: "user.interrupt" }] });
  });
  it("recovers from uncertain interrupt results without creating, resuming or repeating paid work", async () => {
    process.env.BLAZE_CLOUD_WATCHDOG_ENABLED = "true"; await production();
    const fetch = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => { if (init?.method === "POST") throw new Error("Lost interrupt response"); return Response.json({ id: "sesn_p", status: "running" }); }); vi.stubGlobal("fetch", fetch);
    await watchdog.tickProductionWatchdog("ws", now); expect(await db.get("ws", "video_production", "p")).toMatchObject({ stopRequest: { state: "uncertain" } });
    // A fresh consumer only reads the durable marker and observes status.
    await watchdog.tickProductionWatchdog("ws", now + 1000); expect(fetch.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
    expect(await watchdog.watchdogReady("ws", "v1", now + 1000)).toBe(false);
  });
  it("keeps an unknown start or rotated key blocked without guessing a session or credential", async () => {
    process.env.BLAZE_CLOUD_WATCHDOG_ENABLED = "true"; await production("unknown", undefined, { sessionId: undefined, state: "starting" });
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    expect(await watchdog.tickProductionWatchdog("ws", now)).toMatchObject({ healthy: false }); expect(await db.get("ws", "video_production", "unknown")).toMatchObject({ state: "needs_reconciliation" });
    await db.query("DELETE FROM records WHERE kind='video_production'"); await production();
    await (await import("../src/lib/credentials")).saveSecret("ws", "anth", { token: "changed-fixture-secret" });
    expect(await watchdog.tickProductionWatchdog("ws", now + 1000)).toMatchObject({ healthy: false }); expect(fetch).not.toHaveBeenCalled();
  });
  it("leases overlapping polls and retains a consumed dispatch marker across a crash", async () => {
    process.env.BLAZE_CLOUD_WATCHDOG_ENABLED = "true";
    await production("p", undefined, { state: "cancel_requested", stopRequest: { id: "stop_existing", requestedAt: new Date(now - 1000).toISOString(), reason: "owner_cancel", state: "dispatching" } });
    let release!: () => void; let started!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; }); const entered = new Promise<void>(resolve => { started = resolve; });
    const fetch = vi.fn(async () => { started(); await gate; return Response.json({ id: "sesn_p", status: "running" }); }); vi.stubGlobal("fetch", fetch);
    const first = watchdog.tickProductionWatchdog("ws", now); await entered;
    expect(await watchdog.tickProductionWatchdog("ws", now)).toMatchObject({ busy: true }); release(); await first;
    expect(fetch).toHaveBeenCalledOnce(); expect(await db.get("ws", "video_production", "p")).toMatchObject({ state: "cancel_requested", stopRequest: { state: "dispatching" } });
  });
  it("rotates bounded batches so an unresponsive session cannot starve other deadlines", async () => {
    process.env.BLAZE_CLOUD_WATCHDOG_ENABLED = "true";
    for (let i = 0; i < 6; i++) await production(`p${i}`);
    const fetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => init?.method === "POST" ? Response.json({ data: [] }) : Response.json({ id: String(url).split("/").at(-1), status: "running" })); vi.stubGlobal("fetch", fetch);
    expect(await watchdog.tickProductionWatchdog("ws", now)).toMatchObject({ scanned: 4, healthy: false });
    await watchdog.tickProductionWatchdog("ws", now + 1000);
    expect(fetch.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(6);
  });
  it("protects the scheduler route and refuses oversized or ambiguous workspace requests", async () => {
    process.env.CRON_SECRET = "fixture-watchdog-cron";
    const { POST } = await import("../src/app/api/cron/content-production-watchdog/route");
    expect((await POST(new Request("http://localhost/api/cron/content-production-watchdog", { method: "POST" }))).status).toBe(401);
    const headers = { Authorization: "Bearer fixture-watchdog-cron", "Content-Type": "application/json" };
    expect(await (await POST(new Request("http://localhost/api/cron/content-production-watchdog", { method: "POST", headers, body: "{}" }))).json()).toEqual({ paused: true });
    process.env.BLAZE_CLOUD_WATCHDOG_ENABLED = "true";
    expect((await POST(new Request("http://localhost/api/cron/content-production-watchdog", { method: "POST", headers, body: "x".repeat(1025) }))).status).toBe(413);
    expect((await POST(new Request("http://localhost/api/cron/content-production-watchdog", { method: "POST", headers, body: JSON.stringify({ workspaceId: "ws", enable: true }) }))).status).toBe(400);
    expect(await (await POST(new Request("http://localhost/api/cron/content-production-watchdog", { method: "POST", headers, body: JSON.stringify({ workspaceId: "ws" }) }))).json()).toMatchObject({ healthy: true, scanned: 0 });
  });
});
