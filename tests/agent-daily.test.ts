import { beforeAll, beforeEach, expect, it, vi } from 'vitest';
const state=vi.hoisted(()=>({connected:true,fail:false}));
vi.mock('../src/lib/credentials',()=>({researchSecrets:async()=>state.connected?{anthropic:{token:'fixture',model:'fixture'}}:{},secretFor:async()=>undefined}));
vi.mock('../src/lib/integrations',()=>({runResearch:async()=>({findings:[],coverage:[{source:'fixture',status:'complete',detail:'baseline'}]})}));
vi.mock('../src/lib/agent',()=>({anthropicModel:()=>({}),interpretResearch:async()=>{
  if(state.fail) throw new Error('offline');
  return ['gameplay','content'].map(topic=>({gameId:'g',aiTopic:topic,title:`AI suggestion: ${topic}`,detail:'Fixture proposal',type:'hypothesis',priority:'medium',evidence:[{label:'Same evidence'}]}));
}}));
const game={id:'g',title:'Game',url:'https://game.example',description:'',image:'',genre:'',sdkKey:'',origins:[],createdAt:'',dailyEnabled:true,competitors:[]};
let db:typeof import('../src/lib/db'); let researchJob:(typeof import('../src/lib/research-jobs'))['researchJob'];
beforeAll(async()=>{delete process.env.DATABASE_URL; delete process.env.VERCEL; process.env.LOCAL_DATABASE_PATH='memory://'; db=await import('../src/lib/db'); ({researchJob}=await import('../src/lib/research-jobs'));});
beforeEach(async()=>{state.connected=true;state.fail=false;await db.query('DELETE FROM records');await db.query('DELETE FROM daily_runs');});
it('retains baseline and reports disconnected and offline AI',async()=>{
  state.connected=false;
  const missing=await researchJob('ws',game,'2026-01-01');
  expect(missing).toMatchObject({status:'partial'});
  expect('coverage' in missing && missing.coverage).toEqual(expect.arrayContaining([expect.objectContaining({source:'AI research agent',status:'disconnected'}),expect.objectContaining({source:'fixture',status:'complete'})]));
  state.connected=true;state.fail=true;
  const failed=await researchJob('ws',game,'2026-01-02');
  expect('coverage' in failed && failed.coverage).toEqual(expect.arrayContaining([expect.objectContaining({source:'AI research agent',status:'failed'}),expect.objectContaining({source:'fixture',status:'complete'})]));
});
it('keeps different topics separate and retains resolved human content on repeat',async()=>{
  const first=await researchJob('ws',game,'2026-01-01');
  expect('findings' in first && first.findings).toHaveLength(2);
  const all=await db.list<{id:string;status:string;title:string;detail:string}>('ws','finding');
  expect(all).toHaveLength(2);
  const resolved={...all[0],status:'resolved',title:'Human decision',detail:'Owner reviewed this',resolvedAt:'2026-01-01'};
  await db.put('ws','finding',resolved);
  await researchJob('ws',game,'2026-01-02');
  expect(await db.get('ws','finding',resolved.id)).toEqual(resolved);
  expect(await db.list('ws','finding')).toHaveLength(2);
});
