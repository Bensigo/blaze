import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import { validateAdapterSnapshot } from '../worker/adapter';

const script = readFileSync('public/fixture/decision-validation.js', 'utf8');
function load() {
  const ctx = { clearRect: vi.fn(), fillText: vi.fn(), fillStyle: '', font: '' };
  const elements: Record<string, any> = { '#game': { getContext: () => ctx }, '#status': {}, '#left': {}, '#right': {} };
  const window: any = {};
  const fetch = vi.fn();
  runInNewContext(script, { window, document: { querySelector: (selector: string) => elements[selector] }, fetch });
  return { adapter: window.gameMarketingAdapter, elements, fetch };
}
describe('controlled decision lab', () => {
  it.each([['left','won'], ['right','complete']])('offers two choices and records %s as %s', (id, phase) => {
    const {adapter, elements, fetch} = load();
    expect(adapter.getState()).toMatchObject({phase:'ready',selected:null,lab:'decision-validation-v1'});
    expect(Array.from(adapter.actions, (a: any) => a.id)).toEqual(['left','right']);
    expect(validateAdapterSnapshot(adapter.getState(), adapter.actions).terminal).toBe(false);
    adapter.act(id);
    expect(adapter.getState()).toMatchObject({phase,selected:id});
    expect(validateAdapterSnapshot(adapter.getState(), adapter.actions).terminal).toBe(true);
    expect(elements['#status'].textContent).toContain(`Selected ${id}`);
    expect(() => adapter.act(id)).toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });
  it('rejects an unknown action without changing the state', () => {
    const {adapter} = load();
    expect(() => adapter.act('other')).toThrow();
    expect(adapter.getState().phase).toBe('ready');
  });
});
