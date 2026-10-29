import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Finding, Measurement } from '../src/lib/types';

let db: typeof import('../src/lib/db');
let decisions: typeof import('../src/lib/finding-decisions');
const now = new Date('2026-10-29T12:00:00.000Z');
const finding = (overrides: Partial<Finding> = {}): Finding => ({ id: 'f1', gameId: 'g1', title: 'Initial', detail: 'Initial evidence', type: 'observation', priority: 'low', evidence: [{ label: 'first' }], status: 'open', createdAt: '2026-10-28T12:00:00.000Z', ...overrides });
beforeAll(async () => {
  delete process.env.DATABASE_URL; delete process.env.VERCEL; process.env.LOCAL_DATABASE_PATH = 'memory://';
  db = await import('../src/lib/db'); decisions = await import('../src/lib/finding-decisions');
});
beforeEach(async () => { await db.query('DELETE FROM records'); });

describe('atomic finding decisions', () => {
  it.each(['dismissed', 'deferred', 'resolved'] as const)('preserves %s decision across repeated generated updates', async status => {
    await decisions.upsertResearchFinding('ws', finding());
    const choice = status === 'deferred' ? { status, note: 'Review later', deferredUntil: '2026-11-02T12:00:00.000Z' } : { status, note: 'Reviewed' };
    const decided = await decisions.setFindingDecision('ws', 'f1', choice, now);
    for (const detail of ['New observation', 'Newer observation']) {
      await decisions.upsertResearchFinding('ws', finding({ detail, status: 'open', createdAt: '2026-10-30T00:00:00.000Z', evidence: [{ label: detail }] }));
    }
    const result = await db.get<Finding>('ws', 'finding', 'f1');
    expect(result).toMatchObject({ status, detail: 'Newer observation', evidence: [{ label: 'Newer observation' }], createdAt: decided.createdAt, updatedAt: decided.updatedAt, decisionNote: decided.decisionNote });
    if (status === 'deferred') expect(result?.deferredUntil).toBe('2026-11-02T12:00:00.000Z');
    if (status === 'resolved') expect(result?.resolvedAt).toBe(now.toISOString());
  });
  it('rejects missing and foreign-workspace IDs and preserves the original finding', async () => {
    await decisions.upsertResearchFinding('owner', finding());
    await expect(decisions.setFindingDecision('other', 'f1', { status: 'dismissed' }, now)).rejects.toMatchObject({ status: 404 });
    await expect(decisions.setFindingDecision('owner', 'missing', { status: 'dismissed' }, now)).rejects.toMatchObject({ status: 404 });
    expect(await db.get<Finding>('owner', 'finding', 'f1')).toMatchObject({ status: 'open' });
  });
  it('rejects invalid deferrals, statuses and overlong notes without changing stored data', async () => {
    await decisions.upsertResearchFinding('ws', finding());
    for (const deferredUntil of [undefined, 'bad', now.toISOString(), '2028-01-01T00:00:00Z']) {
      await expect(decisions.setFindingDecision('ws', 'f1', { status: 'deferred', deferredUntil }, now)).rejects.toMatchObject({ status: 400 });
    }
    await expect(decisions.setFindingDecision('ws', 'f1', { status: 'open', deferredUntil: '2026-11-01' }, now)).rejects.toMatchObject({ status: 400 });
    await expect(decisions.setFindingDecision('ws', 'f1', { status: 'dismissed', note: 'x'.repeat(501) }, now)).rejects.toMatchObject({ status: 400 });
    await expect(decisions.setFindingDecision('ws', 'f1', { status: 'invalid' as Finding['status'] }, now)).rejects.toMatchObject({ status: 400 });
    expect(await db.get('ws', 'finding', 'f1')).toEqual(finding());
  });
  it('reopens without overwriting fresh evidence or a separately stored measurement', async () => {
    await decisions.upsertResearchFinding('ws', finding());
    await decisions.setFindingDecision('ws', 'f1', { status: 'resolved', note: 'Fixed' }, now);
    const measurement = { id: 'm1', gameId: 'g1', findingId: 'f1', note: 'Observed', startedAt: now.toISOString(), baseline: { sessions: 1, starts: 0, completions: 0, errorSessions: 0 }, after: { sessions: 2, starts: 1, completions: 0, errorSessions: 0 }, daysObserved: 2 } satisfies Measurement;
    await db.put('ws', 'measurement', measurement);
    await decisions.upsertResearchFinding('ws', finding({ detail: 'Updated', evidence: [{ label: 'new' }] }));
    const reopened = await decisions.setFindingDecision('ws', 'f1', { status: 'open' }, new Date(now.getTime() + 1000));
    expect(reopened).toMatchObject({ status: 'open', detail: 'Updated', evidence: [{ label: 'new' }], decisionNote: 'Fixed' });
    expect(reopened.resolvedAt).toBeUndefined();
    expect(await db.get('ws', 'measurement', 'm1')).toEqual(measurement);
  });
  it('preserves a concurrent decision alongside refreshed content', async () => {
    await decisions.upsertResearchFinding('ws', finding());
    await Promise.all([
      decisions.upsertResearchFinding('ws', finding({ detail: 'Fresh', evidence: [{ label: 'fresh' }] })),
      decisions.setFindingDecision('ws', 'f1', { status: 'dismissed', note: 'Owner' }, now),
    ]);
    expect(await db.get('ws', 'finding', 'f1')).toMatchObject({ status: 'dismissed', decisionNote: 'Owner', detail: 'Fresh', evidence: [{ label: 'fresh' }] });
  });
});
