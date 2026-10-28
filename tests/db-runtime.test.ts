import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
const state = vi.hoisted(() => ({
  config: {} as Record<string, unknown>,
  poolCalls: [] as string[],
  txCalls: [] as string[],
  failCreate: false,
  failValidation: true,
  failMigration: true,
  releases: 0,
}));
vi.mock("pg", () => ({
  Pool: class {
    constructor(config: Record<string, unknown>) {
      if (state.failCreate) {
        state.failCreate = false;
        throw new Error("connection setup failed");
      }
      state.config = config;
    }
    async connect() {
      let migrating = false;
      return {
        query: async (sql: string) => {
          state.txCalls.push(sql);
          if (sql.includes("pg_advisory_xact_lock")) migrating = true;
          if (
            sql === "SELECT version FROM schema_migrations ORDER BY version"
          ) {
            if (migrating) return { rows: [] };
            if (state.failValidation) {
              state.failValidation = false;
              throw new Error("offline");
            }
            return { rows: [{ version: 1 }, { version: 2 }, { version: 3 }, { version: 4 }] };
          }
          if (sql === "SELECT 1") return { rows: [{ ok: true }] };
          if (
            sql.includes("CREATE TABLE IF NOT EXISTS users") &&
            state.failMigration
          ) {
            state.failMigration = false;
            throw new Error("migration fault");
          }
          return { rows: [] };
        },
        release: () => {
          state.releases++;
        },
      };
    }
    async end() {}
  },
}));
let db: typeof import("../src/lib/db");
beforeAll(async () => {
  process.env.DATABASE_URL =
    "postgresql://fake:fake@db.example/test?sslmode=require";
  db = await import("../src/lib/db");
});
afterAll(async () => {
  await db.closeDatabase();
  delete process.env.DATABASE_URL;
});
it("validates schema without DDL on production requests and retries after validation failure", async () => {
  await expect(db.query("SELECT 1")).rejects.toThrow("not migrated");
  expect(await db.query("SELECT 1")).toEqual([{ ok: true }]);
  expect(state.config).toMatchObject({
    max: 4,
    statement_timeout: 15000,
    connectionTimeoutMillis: 10000,
  });
  expect(state.txCalls.some((sql) => /CREATE|ALTER/i.test(sql))).toBe(false);
  expect(
    state.txCalls.some((sql) => sql.includes("SET LOCAL statement_timeout")),
  ).toBe(true);
});
it("runs migration on a checked-out connection, rolls back failures, and can retry", async () => {
  state.txCalls = [];
  const before = state.releases;
  await expect(db.migrateDatabase()).rejects.toThrow("migration fault");
  expect(state.txCalls).toContain("ROLLBACK");
  expect(state.releases).toBe(before + 1);
  state.txCalls = [];
  await db.migrateDatabase();
  expect(state.txCalls[0]).toBe("BEGIN");
  expect(
    state.txCalls.some((sql) => sql.includes("pg_advisory_xact_lock")),
  ).toBe(true);
  expect(state.txCalls.at(-1)).toBe("COMMIT");
  expect(state.releases).toBe(before + 2);
});

it("retries client initialization after a failure", async () => {
  await db.closeDatabase();
  state.failCreate = true;
  await expect(db.query("SELECT 1")).rejects.toThrow("connection setup failed");
  expect(await db.query("SELECT 1")).toEqual([{ ok: true }]);
});

it("rejects missing production database on any host and never reuses a cached local database", async () => {
  await db.closeDatabase();
  vi.stubEnv("VERCEL", undefined);
  vi.stubEnv("DATABASE_URL", undefined);
  vi.stubEnv("NODE_ENV", "production");
  const localPath = join(tmpdir(), `blaze-prod-db-${randomUUID()}`);
  vi.stubEnv("LOCAL_DATABASE_PATH", localPath);
  try {
    await expect(db.query("SELECT 1")).rejects.toThrow("Database is not configured");
    expect(existsSync(localPath)).toBe(false);
    // Local development may still use PGlite, even after a failed production initialization.
    vi.stubEnv("LOCAL_DATABASE_PATH", "memory://");
    vi.stubEnv("NODE_ENV", "test");
    expect(await db.query("SELECT 1 AS ok")).toEqual([{ ok: 1 }]);
    // A long-lived development process cannot carry its local client into production.
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DATABASE_URL", "postgresql://fake:fake@db.example/test");
    await expect(db.query("SELECT 1")).rejects.toThrow("Database is not configured");
  } finally {
    await db.closeDatabase();
    vi.unstubAllEnvs();
  }
}, 30000);
