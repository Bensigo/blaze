import { get, put, query } from './db';
import { cleanupCaptures } from './session-capture';

const SYSTEM = '__system__';
export function retentionDays(value = process.env.EVENT_RETENTION_DAYS): number | null {
  if (value === undefined || value === '') return null;
  if (!/^\d+$/.test(value) || Number(value) < 7 || Number(value) > 3650) throw new Error('EVENT_RETENTION_DAYS must be an integer from 7 to 3650.');
  return Number(value);
}
type Status = { id: string; startedAt: string; finishedAt: string; outcome: 'succeeded' | 'failed'; deletedEvents?: number };
export async function runMaintenance() {
  const startedAt = new Date().toISOString();
  try {
    // Capture expiry is independent of raw-event retention configuration.
    const captures = await cleanupCaptures();
    if (captures.failed > 0) throw new Error('Capture cleanup did not complete.');
    const days = retentionDays();
    await query(`DELETE FROM rate_windows WHERE expires_at<now()`);
    await query(`DELETE FROM auth_sessions WHERE expires_at<now()`);
    // Keep player_first_seen: deleting raw events must not reset cohort identity.
    const rows = days === null ? [] : await query<{ count: number }>(`WITH deleted AS (DELETE FROM events WHERE id IN (SELECT id FROM events WHERE occurred_at < now() - ($1::int * interval '1 day') ORDER BY occurred_at, id LIMIT 10000) RETURNING 1) SELECT count(*)::int AS count FROM deleted`, [days]);
    if (Number(rows[0]?.count || 0) === 10000) throw new Error('Event retention reached its batch limit; more events may remain.');
    const status: Status = { id: 'daily', startedAt, finishedAt: new Date().toISOString(), outcome: 'succeeded', deletedEvents: Number(rows[0]?.count || 0) };
    await put(SYSTEM, 'maintenance_status', status);
    return status;
  } catch (error) {
    const status: Status = { id: 'daily', startedAt, finishedAt: new Date().toISOString(), outcome: 'failed' };
    await put(SYSTEM, 'maintenance_status', status).catch(() => {});
    throw error;
  }
}
export async function maintenanceStatus() {
  let days: number | null = null;
  let invalid = false;
  try { days = retentionDays(); } catch { invalid = true; }
  const last = await get<Status>(SYSTEM, 'maintenance_status', 'daily');
  return { eventRetention: invalid ? 'invalid' : days === null ? 'disabled' : 'enabled', retentionDays: days, lastRun: last ? { finishedAt: last.finishedAt, outcome: last.outcome } : null };
}
