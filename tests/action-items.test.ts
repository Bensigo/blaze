import { describe, expect, it } from 'vitest';
import { toActionItem } from '../src/lib/action-items';
import type { Finding, Measurement, Recording } from '../src/lib/types';

const finding = (overrides: Partial<Finding> = {}): Finding => ({ id: 'f1', gameId: 'g1', title: 'Observation', detail: 'A recorded observation.', type: 'observation', priority: 'low', evidence: [], status: 'open', createdAt: '2026-10-29T12:00:00Z', ...overrides });
const recording = (mode: Recording['mode'] = 'fixture'): Recording => ({ id: 'r1', gameId: 'g1', title: 'Run', status: 'ready', mode, createdAt: '2026-10-29T12:00:00Z', observations: [{ at: 3, type: 'observation', text: `Trace v1: ${mode} selected move_left; phase ready -> playing.` }] });

describe('toActionItem', () => {
  it('keeps an unknown observation conservative without inventing evidence or impact', () => {
    const source = finding({ detail: '', evidence: [] });
    const result = toActionItem(source);
    expect(result).toMatchObject({ observation: 'No observation details recorded.', impactHypothesis: 'Impact unknown.', effort: 'unknown', evidence: [], measurements: [], status: 'open' });
    expect(result.suggestion).toContain('reproduce');
    expect(source.status).toBe('open');
  });
  it.each(['fixture', 'jev'] as const)('labels %s trace as a single unconfirmed observation with the selected action and phases', mode => {
    const source = finding({ evidence: [{ label: 'recording', recordingId: 'r1', at: 3 }] });
    const result = toActionItem(source, [], [recording(mode)]);
    expect(result.observation).toContain(mode === 'fixture' ? 'Controlled fixture' : 'Synthetic playthrough');
    expect(result.observation).toContain('not a confirmed bug');
    expect(result.suggestion).toContain('move_left');
    expect(result.suggestion).toContain('ready');
    expect(result.suggestion).toContain('playing');
    expect(result.checkMetric).toContain('same game build and input');
    expect(result.impactHypothesis).toContain('Human impact is unmeasured');
  });
  it('does not interpret an unrelated recording as evidence', () => {
    const result = toActionItem(finding({ evidence: [{ label: 'recording', recordingId: 'r1', at: 3 }] }), [], [{ ...recording(), gameId: 'another' }]);
    expect(result.observation).toBe('A recorded observation.');
  });
  it('labels an X report and its possible relevance as unverified', () => {
    const source = { ...finding({ title: 'X: reported bug', detail: 'Someone reports an issue.' }), feedback: { relevance: 'possible', verification: 'reported_not_reproduced' } };
    expect(toActionItem(source).observation).toContain('Reported on X; not verified. Possible game relevance');
  });
  it('matches measurements by finding and game without claiming causation', () => {
    const base: Measurement = { id: 'm1', gameId: 'g1', findingId: 'f1', note: 'Measured outcome', startedAt: '2026-10-29T12:00:00Z', baseline: { sessions: 1, starts: 1, completions: 0, errorSessions: 0 }, after: { sessions: 2, starts: 2, completions: 1, errorSessions: 0 }, daysObserved: 1 };
    const result = toActionItem(finding(), [base, { ...base, id: 'wrong-game', gameId: 'other' }, { ...base, id: 'wrong-finding', findingId: 'other' }]);
    expect(result.measurements.map(m => m.id)).toEqual(['m1']);
    expect(result.impactHypothesis).toBe('Impact unknown.');
  });
  it('removes unsafe links and keeps dismissed status and owner note', () => {
    const source = finding({ status: 'dismissed', decisionNote: '  Not now  ', evidence: [{ label: 'bad', url: 'javascript:alert(1)' }, { label: 'credentials', url: 'https://user:pass@example.com/' }, { label: 'protocol relative', url: '//evil.test' }, { label: 'safe', url: '/api/recordings/one' }, { label: 'external', url: 'https://example.com/path' }] });
    const result = toActionItem(source);
    expect(result.status).toBe('dismissed');
    expect(result.decisionNote).toBe('Not now');
    expect(result.evidence.map(e => e.url)).toEqual([undefined, undefined, undefined, '/api/recordings/one', 'https://example.com/path']);
    expect(source.evidence[0].url).toBe('javascript:alert(1)');
  });
});
