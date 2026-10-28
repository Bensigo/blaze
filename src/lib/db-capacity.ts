import { query } from "./db";

export type DatabaseUsage = {
  bytes: number | null;
  limitBytes: number | null;
  paused: boolean;
  measuredAt: string | null;
  retentionDays: null;
  reason?: string;
};
const CACHE_MS = 30000;
let cached: { key: string; until: number; value: DatabaseUsage } | undefined;
let pending: { key: string; value: Promise<DatabaseUsage> } | undefined;

/** Current database size is an admission estimate, not Neon project storage accounting. */
export async function databaseUsage(): Promise<DatabaseUsage | undefined> {
  const connection = process.env.DATABASE_URL;
  const setting = process.env.DATABASE_STORAGE_LIMIT_BYTES;
  // Local PGlite never calls Postgres-only size functions. Unconfigured hosted databases opt out explicitly.
  if (!connection || setting === undefined) return undefined;
  const key = `${connection}\n${setting}`;
  const now = Date.now();
  if (cached?.key === key && now < cached.until) return cached.value;
  if (pending?.key === key) return pending.value;
  const task = (async (): Promise<DatabaseUsage> => {
    const limit = Number(setting);
    if (!/^\d+$/.test(setting) || !Number.isSafeInteger(limit) || limit <= 0) return { bytes: null, limitBytes: null, paused: true, measuredAt: null, retentionDays: null, reason: "The configured database limit is invalid; ingestion is paused." };
    try {
      const rows = await query<{ bytes: string | number }>(`SELECT pg_database_size(current_database())::text AS bytes`);
      const raw = rows[0]?.bytes;
      if (!(typeof raw === "number" || (typeof raw === "string" && /^\d+$/.test(raw)))) throw new Error("Invalid database measurement");
      const bytes = Number(raw);
      if (!Number.isSafeInteger(bytes) || bytes < 0) throw new Error("Invalid database measurement");
      const paused = bytes >= Math.floor(limit * 0.8);
      return { bytes, limitBytes: limit, paused, measuredAt: new Date().toISOString(), retentionDays: null, ...(paused ? { reason: "Event ingestion is paused at 80% of the configured current-database limit." } : {}) };
    } catch {
      return { bytes: null, limitBytes: limit, paused: true, measuredAt: null, retentionDays: null, reason: "Database size is unavailable; ingestion is paused until it can be checked." };
    }
  })();
  pending = { key, value: task };
  try {
    const value = await task;
    // A changed config may already have started a newer measurement.
    if (pending?.value === task) cached = { key, until: Date.now() + CACHE_MS, value };
    return value;
  } finally { if (pending?.value === task) pending = undefined; }
}
