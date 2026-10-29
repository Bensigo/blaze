import { describe, expect, it } from 'vitest';
import { RecordingBudget, recordingLimits } from '../worker/recording-limits';
describe('recording limits', () => {
 it('defaults to 30 and accepts a one-action test', () => {
   expect(recordingLimits({})).toEqual({maxActions:30,maxDurationSeconds:30});
   expect(recordingLimits({maxActions:1,maxDurationSeconds:15})).toEqual({maxActions:1,maxDurationSeconds:15});
 });
 it.each([0,-1,31,1.5,'1',null,NaN])('rejects malformed action and duration limits: %s', value => {
   expect(()=>recordingLimits({maxActions:value})).toThrow(); expect(()=>recordingLimits({maxDurationSeconds:value})).toThrow();
 });
 it('permits one action and a final observation, then stops decisions', () => {
   let now=1000; const budget=new RecordingBudget(recordingLimits({maxActions:1,maxDurationSeconds:2}),now,()=>now);
   expect(budget.canAct()).toBe(true); budget.acted(); expect(budget.canAct()).toBe(false); expect(budget.canObserve()).toBe(true);
   now=3000; expect(budget.canAct()).toBe(false); expect(budget.canObserve()).toBe(false);
 });
});
