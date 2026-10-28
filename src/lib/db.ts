import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
type Client = {
  query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }>;
};
const globalDb = globalThis as unknown as {
  studioDb?: Promise<Client>;
  studioSchema?: Promise<void>;
};
async function client(): Promise<Client> {
  if (!globalDb.studioDb)
    globalDb.studioDb = (async () => {
      if (process.env.DATABASE_URL) {
        const { Pool } = await import("pg");
        return new Pool({
          connectionString: process.env.DATABASE_URL,
          max: 4,
          connectionTimeoutMillis: 10000,
          idleTimeoutMillis: 20000,
        });
      }
      if (process.env.VERCEL)
        throw new Error(
          "Database is not configured. Connect a PostgreSQL database.",
        );
      const { PGlite } = await import("@electric-sql/pglite");
      const path = process.env.LOCAL_DATABASE_PATH || resolve(".data/postgres");
      if (path !== "memory://") await mkdir(path, { recursive: true });
      return new PGlite(path);
    })();
  return globalDb.studioDb;
}
const schema = [
  `CREATE TABLE IF NOT EXISTS users (id text PRIMARY KEY, email text NOT NULL, name text NOT NULL, workspace_id text NOT NULL UNIQUE, created_at timestamptz NOT NULL DEFAULT now())`,
  `CREATE TABLE IF NOT EXISTS auth_sessions (token_hash text PRIMARY KEY, user_id text NOT NULL REFERENCES users(id), expires_at timestamptz NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS records (workspace_id text NOT NULL, kind text NOT NULL, id text NOT NULL, body jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(workspace_id,kind,id))`,
  `CREATE INDEX IF NOT EXISTS records_kind_idx ON records(kind,updated_at)`,
  `CREATE TABLE IF NOT EXISTS credentials (workspace_id text NOT NULL, provider text NOT NULL, encrypted text NOT NULL, PRIMARY KEY(workspace_id,provider))`,
  `CREATE TABLE IF NOT EXISTS events (id text PRIMARY KEY,workspace_id text NOT NULL,game_id text NOT NULL,session_id text NOT NULL,player_id text NOT NULL,kind text NOT NULL CHECK(kind IN ('human','agent')),name text NOT NULL,occurred_at timestamptz NOT NULL,received_at timestamptz NOT NULL DEFAULT now(),country text NOT NULL,device text NOT NULL,source text NOT NULL,campaign text NOT NULL,page text NOT NULL,properties jsonb NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS events_scope_idx ON events(workspace_id,game_id,kind,occurred_at)`,
  `CREATE INDEX IF NOT EXISTS events_session_idx ON events(workspace_id,session_id,occurred_at)`,
  `CREATE TABLE IF NOT EXISTS jobs (id text PRIMARY KEY, workspace_id text NOT NULL,kind text NOT NULL,state text NOT NULL,body jsonb NOT NULL,available_at timestamptz NOT NULL DEFAULT now(),lease_until timestamptz,updated_at timestamptz NOT NULL DEFAULT now())`,
  `CREATE INDEX IF NOT EXISTS jobs_queue_idx ON jobs(kind,state,available_at)`,
  `CREATE TABLE IF NOT EXISTS rate_windows (id text PRIMARY KEY,count integer NOT NULL,expires_at timestamptz NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS daily_runs (workspace_id text NOT NULL,game_id text NOT NULL,day text NOT NULL,run_id text NOT NULL,lease_until timestamptz NOT NULL,PRIMARY KEY(workspace_id,game_id,day))`,
  `CREATE TABLE IF NOT EXISTS publish_dispatches (workspace_id text NOT NULL,post_id text NOT NULL,approval_hash text NOT NULL,state text NOT NULL,updated_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(workspace_id,post_id,approval_hash))`,
];
export async function query<T = Record<string, unknown>>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  const db = await client();
  if (!globalDb.studioSchema)
    globalDb.studioSchema = (async () => {
      for (const s of schema) await db.query(s);
    })();
  await globalDb.studioSchema;
  const result = await db.query(sql, params);
  return result.rows as T[];
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
