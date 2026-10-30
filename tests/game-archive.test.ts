import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Game } from "../src/lib/types";
let db: typeof import("../src/lib/db"); let archive: typeof import("../src/lib/game-archive");
beforeAll(async () => { delete process.env.DATABASE_URL; delete process.env.VERCEL; process.env.LOCAL_DATABASE_PATH = "memory://"; db = await import("../src/lib/db"); archive = await import("../src/lib/game-archive"); });
const game: Game = { id: "g", title: "Owned game", url: "https://game.example", description: "", image: "", genre: "", sdkKey: "key", origins: [], createdAt: "2026-10-30T00:00:00Z", dailyEnabled: true, competitors: [] };
beforeEach(async () => { await db.query("DELETE FROM records"); await db.query("DELETE FROM jobs"); await db.query("DELETE FROM events"); await db.query("DELETE FROM player_first_seen"); await db.put("ws", "game", game); });
describe("recoverable game deletion", () => {
  it("requires the exact game identity and owns both deletion and restore", async () => {
    await expect(archive.archiveGame("other", "g", game.title, "owner")).rejects.toThrow("Game not found");
    await expect(archive.archiveGame("ws", "g", "wrong name", "owner")).rejects.toThrow("exact name");
    expect(await db.get("ws", "game", "g")).toMatchObject(game);
    await expect(archive.restoreGame("other", "g")).rejects.toThrow("not found");
  });
  it("removes only active eligibility, retains related data, consumes queued approvals and restores without requeueing", async () => {
    await db.put("ws", "finding", { id: "f", gameId: "g", detail: "Retained evidence" });
    await db.put("ws", "video_production", { id: "p", gameId: "g", state: "approved" });
    await db.put("ws", "post", { id: "post", gameId: "g", status: "scheduled", deliveryMethod: "native", approvedHash: "oldgrant", text: "Keep this copy" });
    await db.query("INSERT INTO jobs(id,workspace_id,kind,state,body) VALUES('job','ws','recording','queued',$1::jsonb)", [JSON.stringify({ gameId: "g" })]);
    const deleted = await archive.archiveGame("ws", "g", game.title, "owner");
    expect(deleted.game.sdkKey).toBe("key"); expect(await db.list("ws", "game")).toEqual([]);
    expect(await db.get("ws", "finding", "f")).toBeTruthy();
    expect(await db.get("ws", "video_production", "p")).toMatchObject({ state: "cancelled" });
    expect(await db.get("ws", "game_automation", "g")).toMatchObject({ enabled: false });
    expect(await db.get("ws", "post", "post")).toMatchObject({ status: "draft", deliveryMethod: "manual", text: "Keep this copy" });
    expect(await db.get("ws", "post", "post")).not.toHaveProperty("approvedHash");
    expect((await db.query<{ state: string }>("SELECT state FROM jobs WHERE id='job'"))[0].state).toBe("failed");
    expect(await archive.archiveGame("ws", "g", game.title, "owner")).toEqual(deleted);
    expect((await archive.archivedGames("ws"))).toHaveLength(1);
    expect(await archive.restoreGame("ws", "g")).toMatchObject({ id: "g", sdkKey: "key", dailyEnabled: false });
    expect(await archive.restoreGame("ws", "g")).toMatchObject({ id: "g" }); expect(await archive.archivedGames("ws")).toEqual([]);
    expect((await db.query<{ state: string }>("SELECT state FROM jobs WHERE id='job'"))[0].state).toBe("failed");
  });
  it("blocks active or uncertain cloud work rather than claiming it stopped", async () => {
    for (const state of ["starting", "running", "importing", "cancel_requested", "needs_reconciliation"]) {
      await db.put("ws", "video_production", { id: "p", gameId: "g", state });
      await expect(archive.archiveGame("ws", "g", game.title, "owner")).rejects.toThrow("active or uncertain");
      expect(await db.get("ws", "game", "g")).toBeTruthy(); expect(await archive.archivedGames("ws")).toEqual([]);
    }
  });
  it("blocks a claimed worker job and makes no provider requests", async () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    await db.query("INSERT INTO jobs(id,workspace_id,kind,state,body) VALUES('job','ws','recording','claimed',$1::jsonb)", [JSON.stringify({ gameId: "g" })]);
    await expect(archive.archiveGame("ws", "g", game.title, "owner")).rejects.toThrow("active or uncertain"); expect(fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals();
  });
  it("includes post-linked claimed jobs in deletion's locked work set", async () => {
    await db.put("ws", "post", { id: "post", gameId: "g", status: "draft" });
    await db.query("INSERT INTO jobs(id,workspace_id,kind,state,body) VALUES('publish','ws','publish','claimed',$1::jsonb)", [JSON.stringify({ postId: "post" })]);
    await expect(archive.archiveGame("ws", "g", game.title, "owner")).rejects.toThrow("active or uncertain");
    expect(await db.get("ws", "game", "g")).toBeTruthy(); expect(await archive.archivedGames("ws")).toEqual([]);
  });
  it("rejects new and requeued jobs after archive, while restore permits fresh work", async () => {
    const profile = await import("../src/lib/game-profile");
    const { enqueue } = await import("../src/lib/jobs");
    await profile.queueProfile("ws", "g", "https://app.example");
    await archive.archiveGame("ws", "g", game.title, "owner");
    await expect(profile.queueProfile("ws", "g", "https://app.example")).rejects.toThrow("Active game not found");
    await expect(profile.queueHumanProfileRefresh("ws", "g", "https://app.example")).rejects.toThrow("Active game not found");
    await expect(enqueue("ws", "clip", { id: "new-clip", gameId: "g" } as import("../src/lib/types").Clip)).rejects.toThrow("Active game not found");
    expect(await db.query("SELECT id FROM jobs WHERE workspace_id='ws' AND state='queued'")).toEqual([]);
    await archive.restoreGame("ws", "g");
    await profile.queueProfile("ws", "g", "https://app.example");
    expect(await db.query("SELECT id FROM jobs WHERE workspace_id='ws' AND state='queued'")).toHaveLength(1);
  });

});
