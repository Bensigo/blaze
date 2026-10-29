import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { applyMigrations, validateSchema } from "./migrations";
import type { Pool } from "pg";
import type { PGlite } from "@electric-sql/pglite";
type Database = { kind: "pg"; pool: Pool } | { kind: "local"; db: PGlite };
export function postgresConnectionString(value: string) {
  const url = new URL(value);
  if (
    ["prefer", "require", "verify-ca"].includes(
      url.searchParams.get("sslmode") || "",
    )
  ) {
    // Preserve pg v8's current strict verification explicitly across future driver upgrades.
    url.searchParams.set("sslmode", "verify-full");
  }
  return url.toString();
}
const globalDb = globalThis as unknown as {
  studioDb?: Promise<Database>;
  studioSchema?: Promise<void>;
};
async function client(): Promise<Database> {
  const requiresPostgres = process.env.NODE_ENV === "production" || !!process.env.VERCEL;
  if (requiresPostgres && !process.env.DATABASE_URL)
    throw new Error("Database is not configured. Connect a PostgreSQL database.");
  if (!globalDb.studioDb) {
    const pending = (async (): Promise<Database> => {
      if (process.env.DATABASE_URL) {
        const { Pool } = await import("pg");
        return {
          kind: "pg",
          pool: new Pool({
            connectionString: postgresConnectionString(
              process.env.DATABASE_URL,
            ),
            max: 4,
            connectionTimeoutMillis: 10000,
            idleTimeoutMillis: 20000,
            statement_timeout: 15000,
          }),
        };
      }
      const { PGlite } = await import("@electric-sql/pglite");
      const path = process.env.LOCAL_DATABASE_PATH || resolve(".data/postgres");
      if (path !== "memory://") await mkdir(path, { recursive: true });
      return { kind: "local", db: new PGlite(path) };
    })();
    globalDb.studioDb = pending;
    pending.catch(() => {
      if (globalDb.studioDb === pending) globalDb.studioDb = undefined;
    });
  }
  const db = await globalDb.studioDb;
  // A cached development client must never become a production fallback.
  if (requiresPostgres && db.kind !== "pg")
    throw new Error("Database is not configured. Connect a PostgreSQL database.");
  return db;
}
export async function migrateDatabase() {
  const db = await client();
  if (db.kind === "local") {
    await db.db.transaction(async (tx) => {
      await applyMigrations(tx);
    });
  } else {
    const tx = await db.pool.connect();
    try {
      await tx.query("BEGIN");
      await tx.query("SET LOCAL lock_timeout = '10s'");
      await tx.query("SET LOCAL statement_timeout = '120s'");
      await tx.query("SELECT pg_advisory_xact_lock(744110219)");
      await applyMigrations(tx);
      await tx.query("COMMIT");
    } catch (error) {
      await tx.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      tx.release();
    }
  }
}
export async function closeDatabase() {
  const pending = globalDb.studioDb;
  globalDb.studioSchema = undefined;
  globalDb.studioDb = undefined;
  if (!pending) return;
  const db = await pending;
  if (db.kind === "local") await db.db.close();
  else await db.pool.end();
}
// PgBouncer can discard startup timeout settings, so set it within each transaction.
async function pgQuery(pool: Pool, sql: string, params: unknown[] = []) {
  const tx = await pool.connect();
  try {
    await tx.query("BEGIN; SET LOCAL statement_timeout = '15s'");
    const result = await tx.query(sql, params);
    await tx.query("COMMIT");
    return result;
  } catch (error) {
    await tx.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    tx.release();
  }
}
async function ensureSchema(db: Database) {
  if (!globalDb.studioSchema) {
    const pending = (async () => {
      if (db.kind === "local") await migrateDatabase();
      else
        await validateSchema({
          query: (sql, params) => pgQuery(db.pool, sql, params),
        });
    })();
    globalDb.studioSchema = pending;
    pending.catch(() => {
      if (globalDb.studioSchema === pending) globalDb.studioSchema = undefined;
    });
  }
  await globalDb.studioSchema;
}
export async function query<T = Record<string, unknown>>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  const db = await client();
  await ensureSchema(db);
  const result =
    db.kind === "local"
      ? await db.db.query(sql, params)
      : await pgQuery(db.pool, sql, params);
  return result.rows as T[];
}
export type TransactionQuery = <Row = Record<string, unknown>>(sql: string, params?: unknown[]) => Promise<Row[]>;
/** Use only database work in the callback; do not hold a transaction across network calls. */
export async function transaction<T>(operation: (query: TransactionQuery) => Promise<T>): Promise<T> {
  const db = await client();
  await ensureSchema(db);
  if (db.kind === "local") {
    return db.db.transaction(async (tx) => operation(async <Row = Record<string, unknown>>(sql: string, params: unknown[] = []) => {
      const result = await tx.query(sql, params);
      return result.rows as Row[];
    }));
  }
  const tx = await db.pool.connect();
  try {
    await tx.query("BEGIN");
    await tx.query("SET LOCAL statement_timeout = '15s'");
    await tx.query("SET LOCAL lock_timeout = '10s'");
    const result = await operation(async <Row = Record<string, unknown>>(sql: string, params: unknown[] = []) => {
      const rows = await tx.query(sql, params);
      return rows.rows as Row[];
    });
    await tx.query("COMMIT");
    return result;
  } catch (error) {
    await tx.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    tx.release();
  }
}
export function id(prefix: string) {
  return `${prefix}_${randomUUID().replaceAll("-", "")}`;
}
export async function list<T>(workspace: string, kind: string): Promise<T[]> {
  return (
    await query<{ body: T }>(
      "SELECT body FROM records WHERE workspace_id=$1 AND kind=$2 ORDER BY updated_at DESC",
      [workspace, kind],
    )
  ).map((r) => r.body);
}
export async function get<T>(
  workspace: string,
  kind: string,
  recordId: string,
): Promise<T | undefined> {
  return (
    await query<{ body: T }>(
      "SELECT body FROM records WHERE workspace_id=$1 AND kind=$2 AND id=$3",
      [workspace, kind, recordId],
    )
  )[0]?.body;
}
export async function put<T extends { id: string }>(
  workspace: string,
  kind: string,
  body: T,
) {
  await query(
    `INSERT INTO records(workspace_id,kind,id,body) VALUES($1,$2,$3,$4::jsonb) ON CONFLICT(workspace_id,kind,id) DO UPDATE SET body=excluded.body,updated_at=now()`,
    [workspace, kind, body.id, JSON.stringify(body)],
  );
  return body;
}
export async function comparePut<T extends { id: string }>(
  workspace: string,
  kind: string,
  expected: T,
  next: T,
) {
  return (
    (
      await query(
        `UPDATE records SET body=$4::jsonb,updated_at=now() WHERE workspace_id=$1 AND kind=$2 AND id=$3 AND body=$5::jsonb RETURNING id`,
        [
          workspace,
          kind,
          expected.id,
          JSON.stringify(next),
          JSON.stringify(expected),
        ],
      )
    ).length > 0
  );
}
export async function remove(
  workspace: string,
  kind: string,
  recordId: string,
) {
  await query(
    "DELETE FROM records WHERE workspace_id=$1 AND kind=$2 AND id=$3",
    [workspace, kind, recordId],
  );
}
export async function rateLimit(key: string, limit: number, seconds = 60) {
  const bucket = Math.floor(Date.now() / (seconds * 1000));
  const rows = await query<{ count: number }>(
    `INSERT INTO rate_windows(id,count,expires_at) VALUES($1,1,now()+($2||' seconds')::interval) ON CONFLICT(id) DO UPDATE SET count=rate_windows.count+1 RETURNING count`,
    [`${key}:${bucket}`, String(seconds * 2)],
  );
  return rows[0].count <= limit;
}
