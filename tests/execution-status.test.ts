import { describe, expect, it, vi } from 'vitest';
vi.mock('../src/lib/db', () => ({ query: vi.fn() }));
import { executionStatus, projectExecutionStatus } from '../src/lib/execution-status';
import { query } from '../src/lib/db';
import type { Recording, ResearchRun } from '../src/lib/types';

const now = Date.parse('2026-10-29T12:00:00Z');
const config = { kind: 'ai_settings', saved_at: '2026-10-29T10:00:00Z', provider: 'openrouter', model: 'model', validated_at: '2026-10-29T10:00:00Z', credential_present: true };
const run = (override: Partial<ResearchRun> = {}): ResearchRun => ({ id: 'run1', gameId: 'g1', status: 'complete', startedAt: '2026-10-29T11:00:00Z', finishedAt: '2026-10-29T11:01:00Z', findings: [], coverage: [], ...override });
const recording = (override: Partial<Recording> = {}): Recording => ({ id: 'r1', gameId: 'g1', title: 'run', mode: 'jev', status: 'ready', createdAt: '2026-10-29T11:00:00Z', ...override });

describe('execution status', () => {
  it('normalizes database timestamps for browser date parsing', () => {
    const status = projectExecutionStatus([{...config,saved_at:'2026-10-29 10:00:00.123+00'}],[],[],'2026-10-29 11:59:30.456+00',{queued:0,expired:0},now,'jev-budget-v1');
    expect(status.ai.savedAt).toBe('2026-10-29T10:00:00.123Z');
    expect(status.worker.lastHeartbeatAt).toBe('2026-10-29T11:59:30.456Z');
    expect(status.worker.oneActionCapable).toBe(true);
  });
  it('shows a newer configuration failure over an older success and skips public-only checks', () => {
    const old=run({startedAt:'2026-10-29T10:00:00Z',ai:{phase:'complete',status:'succeeded',dispatches:1,responses:1,lastAttemptAt:'2026-10-29T10:00:01Z',succeededAt:'2026-10-29T10:01:00Z'}});
    const failed=run({startedAt:'2026-10-29T11:00:00Z',ai:{phase:'configuration',status:'failed',dispatches:0,responses:0,errorCode:'configuration_unavailable'}});
    const publicOnly=run({startedAt:'2026-10-29T11:30:00Z',ai:{phase:'configuration',status:'not_requested',dispatches:0,responses:0}});
    const status=projectExecutionStatus([config],[old,failed,publicOnly],[],null,{queued:0,expired:0},now);
    expect(status.ai.lastRun).toMatchObject({status:'failed',errorCode:'configuration_unavailable'});
    expect(status.ai.lastAttemptAt).toBe('2026-10-29T10:00:01Z');
    expect(status.ai.lastSuccessAt).toBe('2026-10-29T10:01:00Z');
  });
  it('does not present saved settings or legacy coverage as an AI attempt or success', () => {
    const legacy = run({ coverage: [{ source: 'AI research agent', status: 'complete', detail: 'legacy' }] });
    const status = projectExecutionStatus([config], [legacy], [], null, { queued: 0, expired: 0 }, now);
    expect(status.ai).toMatchObject({ credentialPresent: true, lastAttemptAt: null, lastSuccessAt: null, lastRun: null });
    expect(status.ai.nextStep).toContain('Saving settings only checks access');
    expect(status.worker.online).toBe(false);
    expect(status.jev.adapter).toBe('unverified');
  });
  it('distinguishes failed attempts and complete results and preserves recorded timestamps', () => {
    const succeeded = run({ id: 's', startedAt: '2026-10-29T10:20:00Z', ai: { phase: 'complete', status: 'succeeded', dispatches: 1, responses: 1, lastAttemptAt: '2026-10-29T10:21:00Z', succeededAt: '2026-10-29T10:22:00Z' } });
    const failed = run({ id: 'f', ai: { phase: 'inference', status: 'failed', dispatches: 1, responses: 0, lastAttemptAt: '2026-10-29T11:00:30Z', errorCode: 'rate_limited', httpStatus: 429 } });
    const status = projectExecutionStatus([config], [succeeded, failed], [], '2026-10-29T11:58:00Z', { queued: 2, expired: 1 }, now);
    expect(status.ai.lastRun).toMatchObject({ status: 'failed', errorCode: 'rate_limited' });
    expect(status.ai.lastAttemptAt).toBe('2026-10-29T11:00:30Z');
    expect(status.ai.lastSuccessAt).toBe('2026-10-29T10:22:00Z');
    expect(status.worker.online).toBe(false);
    expect(status.research).toMatchObject({ queued: 2, expiredLeases: 1, sinceSelection: true });
  });
  it('does not confuse fixture recordings or stale/future heartbeats with a live worker', () => {
    const fixture = recording({ mode: 'fixture', observations: [{ at: 0, type: 'observation', text: 'Trace v1: fixture selected start; phase ready -> playing.' }] });
    for (const heartbeat of [null, '2026-10-29T11:58:00Z', '2026-10-29T12:00:01Z', 'invalid']) {
      const status = projectExecutionStatus([], [], [fixture], heartbeat, { queued: 0, expired: 0 }, now);
      expect(status.worker.online).toBe(false);
      expect(status.jev.lastRun).toBeNull();
      expect(status.jev.adapter).toBe('unverified');
    }
  });
  it('queries scoped metadata for a game without calling a provider or reading credential contents', async () => {
    const mock = vi.mocked(query);
    mock.mockReset();
    mock.mockResolvedValueOnce([config]).mockResolvedValueOnce([{ body: run() }]).mockResolvedValueOnce([{ body: recording() }]).mockResolvedValueOnce([]).mockResolvedValueOnce([{ queued: 0, expired: 0 }]);
    const result = await executionStatus('workspace', 'g1');
    expect(result.research.status).toBe('complete');
    const calls = mock.mock.calls;
    expect(calls[1][1]).toEqual(['workspace', 'g1']);
    expect(calls[2][1]).toEqual(['workspace', 'g1']);
    expect(calls[4][1]).toEqual(['workspace', 'g1']);
    expect(calls[0][0]).toContain('EXISTS(SELECT 1 FROM credentials');
    expect(calls[0][0]).not.toMatch(/decrypt|encrypted_secret/i);
  });
});
