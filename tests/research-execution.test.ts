import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AIRequestEvent, AIRequestObserver } from '../src/lib/ai-provider';
import type { Game, ResearchRun } from '../src/lib/types';

const state = vi.hoisted(() => ({ snapshots: [] as ResearchRun[], observer: undefined as ((event: unknown) => Promise<void>) | undefined, mode: 'success' as string, readSettings: vi.fn(), resolve: vi.fn(), history: vi.fn(), interpret: vi.fn() }));
vi.mock('../src/lib/db', () => ({
  id: () => 'run1',
  query: async (sql: string) => sql.startsWith('INSERT INTO daily_runs') ? [{ run_id: 'run1' }] : [],
  get: async () => undefined, list: async () => [],
  put: async (_workspace: string, kind: string, value: ResearchRun) => { if (kind === 'run') state.snapshots.push(structuredClone(value)); },
}));
vi.mock('../src/lib/analytics', () => ({ analytics: async () => ({}) }));
vi.mock('../src/lib/credentials', () => ({ secretFor: async () => undefined }));
vi.mock('../src/lib/integrations', () => ({ runResearch: async () => ({ findings: [], coverage: [{ source: 'public', status: 'complete', detail: 'ok' }] }) }));
vi.mock('../src/lib/agent-history', () => ({ loadAgentHistory: state.history }));
vi.mock('../src/lib/ai-settings', () => ({ readAISettings: state.readSettings, resolveAISecret: state.resolve }));
vi.mock('../src/lib/ai-provider', () => ({ aiModel: (_secret: unknown, observer: AIRequestObserver) => { state.observer = observer as typeof state.observer; return {}; } }));
vi.mock('../src/lib/agent', () => ({ interpretResearch: state.interpret }));
import { researchJob } from '../src/lib/research-jobs';

const game: Game = { id: 'g1', title: 'Game', url: 'https://game.example', description: '', image: '', genre: '', sdkKey: '', origins: [], createdAt: '', dailyEnabled: true, competitors: [] };
const event = (phase: AIRequestEvent['phase'], extra: Partial<AIRequestEvent> = {}): AIRequestEvent => ({ phase, at: '2026-10-29T12:00:00.000Z', ...extra });
beforeEach(() => {
  state.snapshots = []; state.observer = undefined; state.mode = 'success';
  state.readSettings.mockReset().mockResolvedValue({ provider: 'openrouter', model: 'test' });
  state.resolve.mockReset().mockResolvedValue({ token: 'secret', model: 'test' });
  state.history.mockReset().mockResolvedValue({});
  state.interpret.mockReset().mockImplementation(async () => {
    const notify = state.observer!;
    await notify(event('dispatched'));
    if (state.mode === 'limit') { for (let i = 0; i < 4; i++) await notify(event('dispatched')); }
    if (state.mode === 'provider-failure') { await notify(event('failed', { errorCode: 'rate_limited', httpStatus: 429 })); throw new Error('private provider body'); }
    await notify(event('responded', { httpStatus: 200 }));
    if (state.mode === 'invalid') throw new Error('private invalid output');
    return [];
  });
});

describe('research execution permission and status', () => {
  it('defaults to deterministic-only without accessing AI settings or inference', async () => {
    const result = await researchJob('ws', game, '2026-10-29');
    expect(result).toMatchObject({ ai: { status: 'not_requested', dispatches: 0, responses: 0 } });
    expect('coverage' in result && result.coverage).toEqual(expect.arrayContaining([expect.objectContaining({ source: 'AI research agent', status: 'not_requested' })]));
    expect(state.readSettings).not.toHaveBeenCalled(); expect(state.resolve).not.toHaveBeenCalled(); expect(state.history).not.toHaveBeenCalled(); expect(state.interpret).not.toHaveBeenCalled();
  });
  it('records explicit AI execution and completion only after interpretation', async () => {
    const result = await researchJob('ws', game, '2026-10-29', { allowAI: true });
    expect(result).toMatchObject({ ai: { provider: 'openrouter', model: 'test', phase: 'complete', status: 'succeeded', dispatches: 1, responses: 1, lastAttemptAt: '2026-10-29T12:00:00.000Z' } });
    expect(state.history).toHaveBeenCalledWith('ws', 'g1');
    expect(state.snapshots.some(s => s.ai?.phase === 'history')).toBe(true);
    expect(state.snapshots.some(s => s.ai?.phase === 'inference' && s.ai.status === 'running')).toBe(true);
    expect(JSON.stringify(result)).not.toContain('secret');
  });
  it('reports missing settings and history failure before any dispatch', async () => {
    state.readSettings.mockResolvedValueOnce(null);
    const missing = await researchJob('ws', game, '2026-10-29', { allowAI: true });
    expect(missing).toMatchObject({ ai: { phase: 'configuration', status: 'failed', errorCode: 'not_configured', dispatches: 0 } });
    expect(state.resolve).not.toHaveBeenCalled();
    state.history.mockRejectedValueOnce(new Error('private history error'));
    const failed = await researchJob('ws', game, '2026-10-30', { allowAI: true });
    expect(failed).toMatchObject({ ai: { phase: 'history', status: 'failed', errorCode: 'history_unavailable', dispatches: 0 } });
    expect(state.interpret).not.toHaveBeenCalled();
    expect(JSON.stringify(failed)).not.toContain('private history error');
  });
  it('records safe provider errors without marking a successful review', async () => {
    state.mode = 'provider-failure';
    const result = await researchJob('ws', game, '2026-10-29', { allowAI: true });
    expect(result).toMatchObject({ ai: { phase: 'inference', status: 'failed', errorCode: 'rate_limited', httpStatus: 429, dispatches: 1, responses: 0 } });
    expect(JSON.stringify(result)).not.toContain('private provider body');
  });
  it('distinguishes an HTTP response from a valid completed result', async () => {
    state.mode = 'invalid';
    const result = await researchJob('ws', game, '2026-10-29', { allowAI: true });
    expect(result).toMatchObject({ ai: { status: 'failed', errorCode: 'invalid_result', dispatches: 1, responses: 1 } });
    expect(JSON.stringify(result)).not.toContain('private invalid output');
  });
  it('rejects a fifth dispatch and records the limit', async () => {
    state.mode = 'limit';
    const result = await researchJob('ws', game, '2026-10-29', { allowAI: true });
    expect(result).toMatchObject({ ai: { status: 'failed', errorCode: 'request_limit', dispatches: 4, responses: 0 } });
  });
});
