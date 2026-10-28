import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("../src/lib/db", () => ({ query: mock.query }));
beforeEach(() => { vi.resetModules(); vi.stubEnv("DATABASE_URL", "postgresql://example/test"); vi.stubEnv("DATABASE_STORAGE_LIMIT_BYTES", "1000"); mock.query.mockReset(); });
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });
describe("database capacity admission", () => {
  it("coalesces concurrent reads and caches measurements for 30 seconds", async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    mock.query.mockResolvedValue([{ bytes: "799" }]);
    const { databaseUsage } = await import("../src/lib/db-capacity");
    const [a, b] = await Promise.all([databaseUsage(), databaseUsage()]);
    expect(a).toMatchObject({ bytes: 799, limitBytes: 1000, paused: false, retentionDays: null }); expect(a).toEqual(b); expect(mock.query).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(29999); await databaseUsage(); expect(mock.query).toHaveBeenCalledTimes(1);
    mock.query.mockResolvedValue([{ bytes: "800" }]); vi.advanceTimersByTime(2);
    expect(await databaseUsage()).toMatchObject({ bytes: 800, paused: true }); expect(mock.query).toHaveBeenCalledTimes(2);
    expect(mock.query.mock.calls[0][0]).toContain("pg_database_size(current_database())");
  });
  it("fails closed on query failure, malformed data or invalid configured limit", async () => {
    mock.query.mockRejectedValue(new Error("private database error"));
    const { databaseUsage } = await import("../src/lib/db-capacity");
    expect(await databaseUsage()).toMatchObject({ bytes: null, limitBytes: 1000, paused: true, measuredAt: null });
    expect(JSON.stringify(await databaseUsage())).not.toContain("private database error"); expect(mock.query).toHaveBeenCalledTimes(1);
    vi.stubEnv("DATABASE_STORAGE_LIMIT_BYTES", "0"); expect(await databaseUsage()).toMatchObject({ limitBytes: null, paused: true });
    vi.stubEnv("DATABASE_STORAGE_LIMIT_BYTES", "1001"); mock.query.mockResolvedValue([{ bytes: null }]);
    expect(await databaseUsage()).toMatchObject({ bytes: null, paused: true });
  });
  it("skips PGlite and an unset PostgreSQL limit but fails closed for an empty setting", async () => {
    const { databaseUsage } = await import("../src/lib/db-capacity");
    vi.stubEnv("DATABASE_URL", ""); expect(await databaseUsage()).toBeUndefined();
    vi.stubEnv("DATABASE_URL", "postgresql://example/test"); vi.stubEnv("DATABASE_STORAGE_LIMIT_BYTES", undefined); expect(await databaseUsage()).toBeUndefined();
    vi.stubEnv("DATABASE_STORAGE_LIMIT_BYTES", ""); expect(await databaseUsage()).toMatchObject({ paused: true, limitBytes: null });
    expect(mock.query).not.toHaveBeenCalled();
  });
});
