import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
const h=vi.hoisted(()=>({fail:false}));
vi.mock('../src/lib/research-jobs',()=>({drainResearch:async()=>[]}));
vi.mock('../src/lib/publishing',()=>({duePublications:async()=>{if(h.fail) throw Error('private provider details');}}));
vi.mock('../src/lib/session-capture',()=>({cleanupCaptures:async()=>{}}));
vi.mock('../src/lib/game-profile',()=>({drainProfile:async()=>{},queueHumanProfileRefresh:async()=>false}));
vi.mock('../src/lib/game-automation',()=>({tickAutomation:async()=>{}}));
vi.mock('../src/lib/content-automation',()=>({drainContentAutomation:async()=>{}}));
// @ts-expect-error Explicit .mts import is compiled by Vitest and Netlify.
import background from '../netlify/functions/blaze-daily-consumer.mts';
let db:typeof import('../src/lib/db'), daily:typeof import('../src/lib/daily-dispatch');
beforeAll(async()=>{vi.stubEnv('DATABASE_URL',undefined);vi.stubEnv('VERCEL',undefined);vi.stubEnv('LOCAL_DATABASE_PATH','memory://');db=await import('../src/lib/db');daily=await import('../src/lib/daily-dispatch');});
beforeEach(async()=>{h.fail=false;await db.query('DELETE FROM records');await db.query('DELETE FROM jobs');await db.query('DELETE FROM daily_runs');vi.stubEnv('CRON_SECRET','fixture-secret');vi.stubEnv('APP_URL',undefined);});
const day=()=>new Date().toISOString().slice(0,10);
async function game(ws:string,id:string){await db.put(ws,'game',{id,dailyEnabled:true});}
describe('daily scheduled dispatch',()=>{
  it('inserts the existing durable jobs once and reports isolated live status',async()=>{
    await game('one','g1');await game('two','g2');await daily.enqueueDailyDispatch();await daily.enqueueDailyDispatch();
    expect(await db.query("SELECT id FROM jobs WHERE kind='research'")).toHaveLength(2);
    expect(await daily.dailyDispatchStatus('one')).toMatchObject({state:'queued',total:1,remaining:1});
    await db.query("UPDATE jobs SET state='complete' WHERE workspace_id='one' AND kind='research'");
    await db.put('one','run',{id:'run1',status:'partial',finishedAt:'2026-10-28T06:01:00.000Z',coverage:[{source:'AI research agent',status:'disconnected'}]});
    await db.query("INSERT INTO daily_runs(workspace_id,game_id,day,run_id,lease_until) VALUES('one','g1',$1,'run1',now())",[day()]);
    expect(await daily.dailyDispatchStatus('one')).toMatchObject({state:'partial',partial:1,remaining:0,lastRunAt:'2026-10-28T06:01:00.000Z'});
    expect(await daily.dailyDispatchStatus('two')).toMatchObject({state:'queued',remaining:1});
  });
  it('authenticates strictly and records a bounded generic failure',async()=>{
    await expect(background(new Request('https://site.test',{method:'POST',headers:{Authorization:'Bearer wrong'}}))).rejects.toThrow('authorization failed');
    expect(daily.dailyAuthorized(new Request('https://site.test',{headers:{Authorization:'Bearer wrong'}}))).toBe(false);
    expect(daily.dailyAuthorized(new Request('https://site.test',{headers:{Authorization:'Bearer fixture-secret'}}))).toBe(true);
    await game('one','g1');await daily.enqueueDailyDispatch();h.fail=true;
    await expect(daily.consumeDailyDispatch()).rejects.toThrow();
    const status=await daily.dailyDispatchStatus('one'); expect(status).toMatchObject({day:day(),state:'failed',remaining:1});
    expect(JSON.stringify(status)).not.toContain('private provider details');
    h.fail=false;await daily.consumeDailyDispatch();expect(await daily.dailyDispatchStatus('one')).toMatchObject({state:'queued'});
  });
  it('dispatches only to the configured fixed origin without redirects and exposes delivery failure',async()=>{
    await game('one','g1');vi.stubEnv('DEPLOY_PRIME_URL','https://preview.example/');
    const fetchMock=vi.spyOn(globalThis,'fetch').mockResolvedValueOnce(new Response(null,{status:202}));
    await daily.dispatchDailyRequest();const [url,options]=fetchMock.mock.calls[0];
    expect(String(url)).toBe('https://preview.example/.netlify/functions/blaze-daily-consumer');expect(options).toMatchObject({redirect:'error',method:'POST',headers:{Authorization:'Bearer fixture-secret'}});
    fetchMock.mockResolvedValueOnce(new Response(null,{status:500}));await expect(daily.dispatchDailyRequest()).rejects.toThrow();
    expect(await daily.dailyDispatchStatus('one')).toMatchObject({state:'failed',remaining:1});fetchMock.mockRestore();
  });
});
