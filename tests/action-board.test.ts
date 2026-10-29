import { describe, expect, it } from 'vitest';
import { ACTION_COLUMNS, columnForAction } from '../src/lib/action-board';
describe('action board grouping', () => {
  it('maps the three stored states and exposes their labels', () => {
    expect(ACTION_COLUMNS).toEqual([{status:'open',label:'To do'},{status:'in_progress',label:'In progress'},{status:'resolved',label:'Done'}]);
    for (const column of ACTION_COLUMNS) expect(columnForAction({status:column.status})).toBe(column.status);
  });
  it('shows only due deferrals in To do without mutating the action', () => {
    const now=Date.parse('2026-10-29T12:00:00Z');
    const item={status:'deferred',deferredUntil:'2026-10-29T12:00:00Z'};
    expect(columnForAction(item,now)).toBe('open');
    expect(item).toEqual({status:'deferred',deferredUntil:'2026-10-29T12:00:00Z'});
    expect(columnForAction({...item,deferredUntil:'2026-10-29T12:00:01Z'},now)).toBeNull();
    expect(columnForAction({status:'deferred'},now)).toBeNull();
    expect(columnForAction({status:'deferred',deferredUntil:'invalid'},now)).toBeNull();
    expect(columnForAction({status:'dismissed'},now)).toBeNull();
  });
});
