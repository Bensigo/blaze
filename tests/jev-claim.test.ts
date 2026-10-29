import {afterAll,beforeAll,beforeEach,describe,expect,it,vi} from 'vitest';
vi.mock('../src/lib/game-automation',async importOriginal=>({...await importOriginal<typeof import('../src/lib/game-automation')>(),tickAutomation:vi.fn()}));
vi.mock('../src/lib/publishing',()=>({duePublications:vi.fn()}));
vi.mock('../src/lib/research-jobs',()=>({drainResearch:vi.fn()}));
vi.mock('../src/lib/game-profile',()=>({drainProfile:vi.fn(),readProfile:vi.fn()}));
vi.mock('../src/lib/content-automation',()=>({drainContentAutomation:vi.fn()}));
vi.mock('../src/lib/synthetic-capability',()=>({mintSyntheticCapability:vi.fn().mockResolvedValue('mock-capability')}));
let db:typeof import('../src/lib/db'),jobs:typeof import('../src/lib/jobs');
const game={id:'g',title:'Game',url:'https://game.example',description:'',image:'',genre:'',sdkKey:'',origins:[],createdAt:'2026-01-01',dailyEnabled:false,competitors:[]};
const recording=(id:string,mode:'jev'|'fixture'='jev')=>({id,gameId:'g',title:'Recording',mode,status:'queued' as const,createdAt:'2026-01-01'});
beforeAll(async()=>{delete process.env.DATABASE_URL;delete process.env.VERCEL;process.env.LOCAL_DATABASE_PATH='memory://';db=await import('../src/lib/db');jobs=await import('../src/lib/jobs');},30000);
afterAll(async()=>{await db.closeDatabase();vi.unstubAllGlobals()});
beforeEach(async()=>{await db.query('DELETE FROM records');await db.query('DELETE FROM jobs');await db.put('ws','game',game);vi.stubGlobal('fetch',vi.fn().mockRejectedValue(new Error('Unexpected provider call')))});
async function seed(rec:ReturnType<typeof recording> & {maxActions?:number;maxDurationSeconds?:number}) {
 await db.put('ws','recording',rec);await db.put('ws','recording_gate',{id:'g',active:rec.id});
 await db.query("INSERT INTO jobs(id,workspace_id,kind,state,body) VALUES($1,'ws','recording','queued',$2::jsonb)",[rec.id,JSON.stringify(rec)]);
}
describe('paid Jev gate and worker capabilities',()=>{
 it('blocks direct Jev enqueue without provider access',async()=>{
   await expect(jobs.enqueue('ws','recording',recording('r'))).rejects.toThrow('Paid Jev runs are blocked');expect(fetch).not.toHaveBeenCalled();expect(await db.list('ws','recording')).toEqual([]);
 });
 it.each([recording('legacy'),{...recording('bounded'),maxActions:1,maxDurationSeconds:30}])('fails pre-existing Jev job $id before sending any credential',async rec=>{
   await seed(rec);const result=await jobs.claimJob('jev-actions-v1');expect(result).toEqual({});expect(fetch).not.toHaveBeenCalled();
   expect((await db.get<{id:string;status:string;error:string}>('ws','recording',rec.id))).toMatchObject({status:'failed',error:expect.stringContaining('Paid Jev runs are blocked')});
   expect((await db.get<{id:string;active?:string}>('ws','recording_gate','g'))?.active).toBeUndefined();
 });
 it('leaves capped fixture jobs queued for missing or wrong protocol and claims with a capable worker',async()=>{
   await jobs.enqueue('ws','recording',{...recording('fixture','fixture'),maxActions:1,maxDurationSeconds:15});
   for(const protocol of [undefined,'wrong']) {expect(await jobs.claimJob(protocol)).toEqual({});expect((await db.query<{state:string}>("SELECT state FROM jobs WHERE id='fixture'"))[0].state).toBe('queued');expect((await db.query<{body:unknown}>("SELECT body FROM jobs WHERE id='worker-runtime'"))[0].body).toEqual({protocol:'legacy',supportsBoundedRecording:false});}
   expect(await jobs.claimJob('jev-actions-v1')).toMatchObject({recording:{id:'fixture',mode:'fixture'},limits:{maxActions:1,maxDurationSeconds:15}});expect(fetch).not.toHaveBeenCalled();
 });
 it('fails a widened capped fixture and releases its gate',async()=>{
   await jobs.enqueue('ws','recording',{...recording('f','fixture'),maxActions:1,maxDurationSeconds:15});const rec=await db.get<any>('ws','recording','f');await db.put('ws','recording',{...rec,maxActions:30});expect(await jobs.claimJob('jev-actions-v1')).toEqual({});expect((await db.get<{id:string;status:string}>('ws','recording','f'))?.status).toBe('failed');expect((await db.get<{id:string;active?:string}>('ws','recording_gate','g'))?.active).toBeUndefined();
 });
 it('claims ordinary fixture with legacy worker, without Jev credentials',async()=>{
   await jobs.enqueue('ws','recording',recording('r','fixture'));const result=await jobs.claimJob();expect(result).toMatchObject({recording:{id:'r',mode:'fixture'}});expect(result.jevKey).toBeUndefined();expect(fetch).not.toHaveBeenCalled();
 });
});
