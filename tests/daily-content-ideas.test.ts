import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ generate: vi.fn() }));
vi.mock("ai", () => ({ generateText: mock.generate }));
let db: typeof import("../src/lib/db"); let runner: typeof import("../src/lib/daily-content-ideas");
beforeAll(async () => {
  delete process.env.DATABASE_URL; delete process.env.VERCEL; process.env.LOCAL_DATABASE_PATH = "memory://";
  process.env.CREDENTIAL_KEY = Buffer.alloc(32, 17).toString("base64");
  db = await import("../src/lib/db"); runner = await import("../src/lib/daily-content-ideas");
});
const now = new Date("2026-10-30T05:00:00Z");
beforeEach(async () => {
  await db.query("DELETE FROM records"); await db.query("DELETE FROM credentials"); await db.query("DELETE FROM jobs"); mock.generate.mockReset();
  process.env.BLAZE_DAILY_IDEAS_ENABLED = "true";
  const schedule = { id: "default" as const, enabled: true, localTime: "08:00", timeZone: "Asia/Dubai" as const, countPerGame: 3 as const, maxOutputTokensPerGame: 1800 };
  await db.put("ws", "idea_schedule", schedule);
  await db.put("ws", "connection", { id: "anth", provider: "anthropic", connected: true, label: "Existing", model: "test", checkedAt: now.toISOString(), credentialVersion: "key1" });
  const { saveSecret } = await import("../src/lib/credentials"); await saveSecret("ws", "anth", { token: "test-not-real", model: "test" });
  await db.put("ws", "ai_settings", { id: "default", provider: "anthropic", connectionId: "anth", model: "test", validatedAt: now.toISOString(), revision: "ai1" });
  await db.put("ws", "daily_idea_authorization", { id: "default", expiresAt: "2026-11-01T00:00:00Z", scheduleHash: runner.ideaScheduleHash(schedule), aiSettingsRevision: "ai1", credentialVersion: "key1" });
  for (const id of ["game1", "game2"]) {
    await db.put("ws", "game", { id, title: id, url: `https://game.example/${id}`, origins: ["https://game.example"], competitors: [], createdAt: now.toISOString() });
    await db.put("ws", "game_profile", { id, gameId: id, result: "complete", facts: [{ key: "manifest_description", value: `Move the token in ${id}`, evidence: { source: "Manifest", observedAt: now.toISOString() } }], prerequisites: [] });
  }
  mock.generate.mockImplementation(async ({ prompt }: { prompt: string }) => {
    const { source } = JSON.parse(prompt);
    return { text: JSON.stringify({ ideas: [1, 2, 3].map(n => ({ title: `${source.gameId} angle ${n}`, hook: "Move the token", treatment: `Show actual token action ${n}`, shots: ["Start play", "Show action"], factKeys: ["manifest_description"] })) }), usage: { inputTokens: 40, outputTokens: 90 } };
  });
});
describe("daily ideas", () => {
  it("generates three per game once on the Dubai date and records token usage without inventing a cost", async () => {
    const result = await runner.runDailyIdeas("ws", now); expect(result.batches).toHaveLength(2); expect(result.batches.every(b => b.state === "complete")).toBe(true);
    expect(await db.list("ws", "content_idea")).toHaveLength(6); expect(mock.generate).toHaveBeenCalledTimes(2);
    await runner.runDailyIdeas("ws", new Date("2026-10-30T06:00:00Z")); expect(mock.generate).toHaveBeenCalledTimes(2);
    expect(result.batches[0].usage).toMatchObject({ inputTokens: 40, outputTokens: 90, costStatus: "unavailable" });
    expect(mock.generate.mock.calls[0][0]).toMatchObject({ maxRetries: 0, maxOutputTokens: 1800 });
  });
  it("does not retry failed or interrupted paid batches and rejects invalid citations", async () => {
    mock.generate.mockResolvedValue({ text: JSON.stringify({ ideas: [1, 2, 3].map(n => ({ title: `Invented ${n}`, hook: "unknown", treatment: "unknown", shots: ["one", "two"], factKeys: ["unknown"] })) }), usage: {} });
    expect((await runner.runDailyIdeas("ws", now)).batches.every(b => b.state === "failed")).toBe(true);
    await runner.runDailyIdeas("ws", now); expect(mock.generate).toHaveBeenCalledTimes(2); expect(await db.list("ws", "content_idea")).toEqual([]);
  });
  it("requires fresh schedule/provider authorization and waits until the selected local time", async () => {
    expect((await runner.runDailyIdeas("ws", new Date("2026-10-30T03:00:00Z"))).batches).toEqual([]);
    await db.put("ws", "daily_idea_authorization", { id: "default", expiresAt: "2020-01-01T00:00:00Z" });
    expect(await runner.runDailyIdeas("ws", now)).toMatchObject({ paused: true }); expect(mock.generate).not.toHaveBeenCalled();
  });
});
