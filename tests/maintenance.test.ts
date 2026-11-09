import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ query: vi.fn(), put: vi.fn(), get: vi.fn(), cleanup: vi.fn(), identity: vi.fn() }));
vi.mock('../src/lib/db', () => ({ query: mocks.query, put: mocks.put, get: mocks.get }));
vi.mock('../src/lib/session-capture', () => ({ cleanupCaptures: mocks.cleanup }));
vi.mock('../src/lib/auth', () => ({ requireIdentity: mocks.identity, apiError: () => new Response(null, { status: 401 }) }));
import { retentionDays, runMaintenance, maintenanceStatus } from '../src/lib/maintenance';
import { GET } from '../src/app/api/maintenance/status/route';
beforeEach(() => { vi.clearAllMocks(); delete process.env.EVENT_RETENTION_DAYS; mocks.query.mockResolvedValue([]); mocks.put.mockResolvedValue(undefined); mocks.get.mockResolvedValue(undefined); mocks.cleanup.mockResolvedValue({ expired: 0, failed: 0 }); });
it('validates optional retention and reports unobserved maintenance', async () => {
  expect(retentionDays()).toBeNull();
  for (const value of ['0', '6', '3651', '1.5', 'abc']) expect(() => retentionDays(value)).toThrow();
  expect(retentionDays('7')).toBe(7);
  expect(await maintenanceStatus()).toMatchObject({ eventRetention: 'disabled', lastRun: null });
});
it('does not delete events when disabled, and preserves first-seen records when enabled', async () => {
  await runMaintenance();
  expect(mocks.query.mock.calls.some(([sql]) => sql.includes('DELETE FROM events'))).toBe(false);
  process.env.EVENT_RETENTION_DAYS = '30';
  mocks.query.mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce([{ count: 3 }]);
  await runMaintenance();
  expect(mocks.query.mock.calls.some(([sql]) => sql.includes('DELETE FROM player_first_seen'))).toBe(false);
  expect(mocks.put).toHaveBeenLastCalledWith('__system__', 'maintenance_status', expect.objectContaining({ outcome: 'succeeded', deletedEvents: 3 }));
});
it('records failure and requires authentication for status', async () => {
  mocks.cleanup.mockRejectedValue(new Error('failed'));
  await expect(runMaintenance()).rejects.toThrow();
  expect(mocks.put).toHaveBeenCalledWith('__system__', 'maintenance_status', expect.objectContaining({ outcome: 'failed' }));
  mocks.identity.mockRejectedValue(new Error('unauthorized'));
  expect((await GET()).status).toBe(401);
});

it('runs capture cleanup even with invalid retention and skips raw event deletion', async () => {
  process.env.EVENT_RETENTION_DAYS = 'invalid';
  await expect(runMaintenance()).rejects.toThrow('EVENT_RETENTION_DAYS');
  expect(mocks.cleanup).toHaveBeenCalledOnce();
  expect(mocks.query.mock.calls.some(([sql]) => sql.includes('DELETE FROM events'))).toBe(false);
  expect(mocks.put).toHaveBeenCalledWith('__system__', 'maintenance_status', expect.objectContaining({ outcome: 'failed' }));
});
it('reports capture cleanup failures and skips event deletion', async () => {
  process.env.EVENT_RETENTION_DAYS = '30';
  mocks.cleanup.mockResolvedValue({ expired: 2, failed: 1 });
  await expect(runMaintenance()).rejects.toThrow('Capture cleanup');
  expect(mocks.query.mock.calls.some(([sql]) => sql.includes('DELETE FROM events'))).toBe(false);
  expect(mocks.put).toHaveBeenCalledWith('__system__', 'maintenance_status', expect.objectContaining({ outcome: 'failed' }));
});
it('bounds event deletion and reports a full batch as incomplete', async () => {
  process.env.EVENT_RETENTION_DAYS = '30';
  mocks.query.mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce([{ count: 10000 }]);
  await expect(runMaintenance()).rejects.toThrow('batch limit');
  const deletion = mocks.query.mock.calls.find(([sql]) => sql.includes('DELETE FROM events'));
  expect(deletion?.[0]).toContain('LIMIT 10000');
  expect(mocks.put).toHaveBeenCalledWith('__system__', 'maintenance_status', expect.objectContaining({ outcome: 'failed' }));
});
