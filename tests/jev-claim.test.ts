import {randomBytes} from 'node:crypto';
import {afterAll,beforeAll,beforeEach,describe,expect,it,vi} from 'vitest';
vi.mock('../src/lib/game-automation',async importOriginal=>({...await importOriginal<typeof import('../src/lib/game-automation')>(),tickAutomation:vi.fn()}));
vi.mock('../src/lib/publishing',()=>({duePublications:vi.fn()}));
vi.mock('../src/lib/research-jobs',()=>({drainResearch:vi.fn()}));
vi.mock('../src/lib/game-profile',()=>({drainProfile:vi.fn(),readProfile:vi.fn()}));
vi.mock('../src/lib/content-automation',()=>({drainContentAutomation:vi.fn()}));
vi.mock('../src/lib/synthetic-capability',()=>({mintSyntheticCapability:vi.fn().mockResolvedValue('mock-capability')}));
let db:typeof import('../src/lib/db'), settings:typeof import('../src/lib/ai-settings'), credentials:typeof import('../src/lib/credentials'), jobs:typeof import('../src/lib/jobs');
const model='typesafe/jev-1.13';
const game={id:'g',title:'Game',url:'https://game.example',description:'',image:'',genre:'',sdkKey:'',origins:[],createdAt:'2026-01-01',dailyEnabled:false,competitors:[]};
const recording=(id:string,mode:'jev'|'fixture'='jev')=>({id,gameId:'g',title:'Recording',mode,status:'queued' as const,createdAt:'2026-01-01'});
beforeAll(async()=>{delete process.env.DATABASE_URL;delete process.env.VERCEL;process.env.LOCAL_DATABASE_PATH='memory://';process.env.CREDENTIALS_ENCRYPTION_KEY=randomBytes(32).toString('hex');db=await import('../src/lib/db');settings=await import('../src/lib/ai-settings');credentials=await import('../src/lib/credentials');jobs=await import('../src/lib/jobs');},30000);
afterAll(async()=>{await db.closeDatabase();vi.unstubAllGlobals()});
beforeEach(async()=>{await db.query('DELETE FROM records');await db.query('DELETE FROM credentials');await db.query('DELETE FROM jobs');await db.put('ws','game',game);vi.stubGlobal('fetch',vi.fn().mockImplementation(async(url:string)=>new Response(JSON.stringify(url.endsWith('/key')?{data:{}}:{data:{id:model,architecture:{input_modalities:['text'],output_modalities:['decisions']},endpoints:[{provider_name:'TypeSafe',status:0}]}}))));});
async function configured(workspace='ws'){return settings.saveJevSettings(workspace,{token:'mock-router-key',model});}
async function checkFailed(id:string){expect(await jobs.claimJob()).toEqual({});const rec=await db.get<{id:string;status:string;error:string}>('ws','recording',id);expect(rec?.status).toBe('failed');const gate=await db.get<{id:string;active?:string}>('ws','recording_gate','g');expect(gate?.active).toBeUndefined();expect((await db.query<{state:string}>('SELECT state FROM jobs WHERE id=$1',[id]))[0].state).toBe('failed');return rec;}
describe('Jev queue and worker claim',()=>{
  it('requires explicit OpenRouter configuration and ignores an old TypeSafe key',async()=>{
    await db.put('ws','connection',{id:'old',provider:'jev',label:'old',connected:true});await credentials.saveSecret('ws','old',{token:'old-typesafe-key'});
    await expect(jobs.enqueue('ws','recording',recording('r'))).rejects.toThrow('Configure Jev');
    expect(await credentials.secretFor('ws','jev')).toBeUndefined();
  });
  it('pins the exact workspace selection and returns key/model only on worker claim',async()=>{
    await configured();const rec=recording('r');await jobs.enqueue('ws','recording',rec);
    expect(rec).toMatchObject({jevSelection:{model,connectionId:expect.any(String),settingsRevision:expect.any(String),credentialVersion:expect.any(String)}});
    expect(JSON.stringify(await db.get('ws','recording','r'))).not.toContain('mock-router-key');
    expect(await jobs.claimJob()).toMatchObject({jevKey:'mock-router-key',jevModel:model,recording:{id:'r'}});
  });
  it('fails old unpinned queued jobs and releases the recording gate',async()=>{
    await configured(); await jobs.enqueue('ws','recording',recording('r')); const rec=await db.get<any>('ws','recording','r');delete rec.jevSelection;await db.put('ws','recording',rec);
    expect((await checkFailed('r'))?.error).toContain('no Jev selection');
  });
  it('fails when gameplay settings change after enqueue',async()=>{
    await configured();await jobs.enqueue('ws','recording',recording('r'));
    const saved=await db.get<any>('ws','jev_settings','default');await db.put('ws','jev_settings',{...saved,revision:'new-revision'});
    expect((await checkFailed('r'))?.error).toContain('changed');
  });
  it('fails after key rotation under the same ID',async()=>{
    const saved=await configured();await jobs.enqueue('ws','recording',recording('r'));await credentials.saveSecret('ws',saved.id,{token:'other-mock-key'});
    expect((await checkFailed('r'))?.error).toContain('changed');
  });
  it('does not select a key from another workspace',async()=>{
    await configured('other');await expect(jobs.enqueue('ws','recording',recording('r'))).rejects.toThrow('Configure Jev');
  });
  it('fails and releases the gate when the selected model becomes unavailable',async()=>{
    await configured();await jobs.enqueue('ws','recording',recording('r'));vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response('',{status:404})));
    expect((await checkFailed('r'))?.error).toContain('unavailable');
  });
  it('claims fixture without Jev configuration or transmitting Jev credentials',async()=>{
    await jobs.enqueue('ws','recording',recording('r','fixture')); const result=await jobs.claimJob();
    expect(result).toMatchObject({recording:{id:'r',mode:'fixture'}});expect(result.jevKey).toBeUndefined();expect(result.jevModel).toBeUndefined();expect(fetch).not.toHaveBeenCalled();
  });
});
