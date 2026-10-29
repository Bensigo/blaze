import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RunEvidence } from '../worker/observations';
import { choose } from '../worker/jev-decision';
import { validateAdapterSnapshot } from '../worker/adapter';
import { RecordingBudget, recordingLimits } from '../worker/recording-limits';
const db = vi.hoisted(() => ({ get: vi.fn(), query: vi.fn() }));
vi.mock('../src/lib/db', () => db);
import { persistGameplayFindings, validateGameplayEvidence } from '../src/lib/gameplay-evidence';
import type { Recording } from '../src/lib/types';
const recording: Recording = { id: 'r1', gameId: 'g1', title: 'Run', status: 'ready', mode: 'jev', createdAt: '2026-01-01T00:00:00Z', duration: 10, actions: [{id:'left',at:2}], observations: [{at:1,type:'observation',text:'Trace v1: jev selected left; phase ready -> playing.'}] };
beforeEach(() => { db.get.mockReset(); db.query.mockReset(); db.get.mockImplementation(async (_ws,kind) => kind === 'recording' ? recording : {id:'g1'}); });
describe('gameplay evidence', () => {
 it('traces a controlled decision through an observed phase without copying state', () => {
   const e = new RunEvidence(); e.decision('jev','left','ready'); e.state({phase:'playing', secret:'hidden'}, 'opaque');
   const notes=e.finish({fixture:false}); expect(notes.some(n=>n.text==='Trace v1: jev selected left; phase ready -> playing.')).toBe(true); expect(JSON.stringify(notes)).not.toContain('hidden');
 });
 it('carries a mocked Jev choice through an allowed action and observed result into a Finding', async () => {
   const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({model:'typesafe/jev-1.13',answers:{next:{type:'choice',choice:'left'}}})));
   try {
     const budget = new RecordingBudget(recordingLimits({maxActions:1}), Date.now());
     const choices = [{id:'left',label:'Left'},{id:'right',label:'Right'}];
     const before = validateAdapterSnapshot({phase:'ready'}, choices);
     const selected = await choose({phase:'ready'}, before.actions, 'mock-key', 'typesafe/jev-1.13');
     const act = vi.fn(); const e = new RunEvidence(); expect(budget.canAct()).toBe(true); e.decision('jev',selected,before.phase); act(selected); budget.acted(); expect(budget.canAct()).toBe(false); expect(budget.canObserve()).toBe(true); e.state({phase:'playing'}, 'playing');
     const notes = e.finish({fixture:false}); const trace = notes.find(n=>n.text.startsWith('Trace v1:'))!;
     const run = {...recording, actions:[{id:selected,at:trace.at}], observations:[trace]};
     db.get.mockImplementation(async (_ws,kind)=>kind==='recording'?run:{id:'g1'});
     await persistGameplayFindings('ws-a',run);
     expect(act).toHaveBeenCalledOnce(); expect(fetcher).toHaveBeenCalledOnce(); expect(act).toHaveBeenCalledWith('left'); expect(JSON.parse(db.query.mock.calls[0][1][2]).detail).toContain('ready -> playing');
   } finally { fetcher.mockRestore(); }
 });
 it('inserts scoped findings without overwriting owner status', async () => {
   await persistGameplayFindings('ws-a',recording); expect(db.query).toHaveBeenCalledOnce();
   const [sql,args]=db.query.mock.calls[0]; expect(sql).toContain('ON CONFLICT DO NOTHING'); expect(args[0]).toBe('ws-a'); const f=JSON.parse(args[2]); expect(f.gameId).toBe('g1'); expect(f.evidence[0]).toMatchObject({recordingId:'r1',at:1}); expect(f.detail).toContain('not human feedback');
 });
 it('rejects cross-game, malformed, out of bounds and unbacked traces', async () => {
   db.get.mockImplementation(async (_ws,kind)=>kind==='recording'?{...recording,gameId:'other'}:{id:'g1'}); await expect(persistGameplayFindings('ws-a',recording)).rejects.toThrow('belong');
   for (const bad of [ {...recording, actions:[]}, {...recording, observations:[{at:11,type:'observation',text:'x'}]}, {...recording, observations:[{at:1,type:'observation',text:'Trace v1: jev selected <script>; phase ready -> playing.'}]} ]) expect(()=>validateGameplayEvidence(bad as Recording)).toThrow();
 });
 it('requires an executed action even when its result was not observed',()=>{
   const unobserved={...recording,actions:[],observations:[{at:1,type:'observation' as const,text:'Trace v1: jev selected left; phase ready -> result_unobserved.'}]};
   expect(()=>validateGameplayEvidence(unobserved)).toThrow('action missing');
   expect(()=>validateGameplayEvidence({...unobserved,actions:[{id:'left',at:2}]})).not.toThrow();
 });
 it('labels fixture evidence and preserves failure as an observation', async () => {
   const fixture={...recording,mode:'fixture' as const,status:'failed' as const,error:'adapter_failed',observations:[{at:1,type:'observation' as const,text:'Trace v1: fixture selected left; phase ready -> action_or_run_failed.'}]}; db.get.mockImplementation(async (_ws,kind)=>kind==='recording'?fixture:{id:'g1'});
   await persistGameplayFindings('ws',fixture); expect(db.query).toHaveBeenCalledTimes(2); expect(JSON.parse(db.query.mock.calls[0][1][2]).title).toContain('fixture');
 });
});
