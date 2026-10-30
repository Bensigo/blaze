import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const watchdog = vi.hoisted(() => vi.fn());
const refresh = vi.hoisted(() => vi.fn());
vi.mock("../src/lib/content-production-watchdog", () => ({ tickProductionWatchdog: watchdog }));
vi.mock("../src/lib/content-studio", () => ({ refreshVideo: refresh }));
let db: typeof import("../src/lib/db");
let worker: typeof import("../src/lib/content-production-worker");
beforeAll(async () => {
  delete process.env.DATABASE_URL; delete process.env.VERCEL; process.env.LOCAL_DATABASE_PATH = "memory://";
  db = await import("../src/lib/db"); worker = await import("../src/lib/content-production-worker");
});
beforeEach(async () => {
  await db.query("DELETE FROM records"); await db.query("DELETE FROM jobs");
  watchdog.mockReset().mockResolvedValue({ paused: false, healthy: true }); refresh.mockReset().mockResolvedValue({ state: "running" });
});
async function production(id: string, extra: Record<string, unknown> = {}, workspace = "ws") {
  await db.put(workspace, "video_production", { id, state: "running", sessionId: `sesn_${id}`, watchdogDeadlineAt: new Date(Date.now() + 600000).toISOString(), ...extra });
}
describe("scheduled production reconciliation", () => {
  it("gives the watchdog priority and leaves paused or unhealthy work alone", async () => {
    await production("a"); watchdog.mockResolvedValueOnce({ paused: true }).mockResolvedValueOnce({ healthy: false });
    await worker.tickContentProduction("ws"); await worker.tickContentProduction("ws");
    expect(refresh).not.toHaveBeenCalled(); expect(watchdog).toHaveBeenCalledWith("ws", expect.any(Number), { maxBatch: 1 });
  });
  it("processes one eligible record per tick, rotating across workspace records", async () => {
    await production("a"); await production("b"); await production("other", {}, "other");
    await worker.tickContentProduction("ws"); await worker.tickContentProduction("ws");
    expect(refresh.mock.calls.map(call => call[1])).toEqual(["a", "b"]);
    expect(refresh.mock.calls[0][2]).toMatchObject({ maxVideoBytes: 25 * 1024 * 1024, signal: expect.any(AbortSignal) });
  });
  it("does not poll work close to its deadline or without a session", async () => {
    await production("a", { watchdogDeadlineAt: new Date(Date.now() + 30000).toISOString() });
    await production("b", { sessionId: undefined });
    expect(await worker.tickContentProduction("ws")).toMatchObject({ reconciled: 0 }); expect(refresh).not.toHaveBeenCalled();
  });
  it("keeps a claim after an uncertain failure and does not repeat it", async () => {
    await production("a"); refresh.mockRejectedValueOnce(new Error("private provider details"));
    expect(await worker.tickContentProduction("ws")).toMatchObject({ reconciliationRequired: true });
    expect(await db.get("ws", "video_production", "a")).toMatchObject({ state: "needs_reconciliation", error: expect.stringContaining("Refresh") });
    await worker.tickContentProduction("ws"); expect(refresh).toHaveBeenCalledOnce();
    expect((await db.query<{ state: string }>("SELECT state FROM jobs"))[0].state).toBe("failed");
  });
  it("does not overwrite a concurrent completed result after a failed refresh", async () => {
    await production("a");
    refresh.mockImplementation(async () => { await db.put("ws", "video_production", { id: "a", state: "ready", videoUrl: "/api/media/fixture" }); throw new Error("lost response"); });
    await worker.tickContentProduction("ws");
    expect(await db.get("ws", "video_production", "a")).toMatchObject({ state: "ready", videoUrl: "/api/media/fixture" });
  });
  it("reclaims an expired process lease to reconcile an interrupted import without generating", async () => {
    await production("a", {state:"importing"});
    const {hash}=await import("../src/lib/security");
    const id=`content_reconciliation_${hash(JSON.stringify(["ws","a"])).slice(0,32)}`;
    await db.query(`INSERT INTO jobs(id,workspace_id,kind,state,body,lease_until) VALUES($1,'ws','content_reconciliation','claimed','{"productionId":"a","token":"dead-process"}'::jsonb,now()+interval '120 seconds')`,[id]);
    await worker.tickContentProduction("ws");expect(refresh).not.toHaveBeenCalled();
    await db.query("UPDATE jobs SET lease_until=now()-interval '1 second' WHERE id=$1",[id]);
    await worker.tickContentProduction("ws");expect(refresh).toHaveBeenCalledOnce();
  });
  it("prevents concurrent ticks from importing the same record", async () => {
    await production("a"); let release!: () => void; let entered!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; }); const started = new Promise<void>(resolve => { entered = resolve; });
    refresh.mockImplementation(async () => { entered(); await gate; });
    const first = worker.tickContentProduction("ws"); await started;
    await worker.tickContentProduction("ws"); release(); await first;
    expect(refresh).toHaveBeenCalledOnce();
  });
});
