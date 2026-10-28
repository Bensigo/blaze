import { beforeAll, describe, expect, it, vi } from 'vitest';
import { MockLanguageModelV4 } from 'ai/test';
import { anthropicModel, interpretResearch } from '../src/lib/agent';
import { loadAgentHistory } from '../src/lib/agent-history';
import { draftContent } from '../src/lib/integrations/writing';
import type { Game } from '../src/lib/types';

const game:Game={id:'g',title:'Game',url:'https://game.example',description:'',image:'',genre:'',sdkKey:'',origins:[],createdAt:'',dailyEnabled:true,competitors:[]};
const usage={inputTokens:{total:10,noCache:10,cacheRead:undefined,cacheWrite:undefined},outputTokens:{total:10,text:10,reasoning:undefined}};
const finish=(text:string)=>({content:[{type:'text' as const,text}],finishReason:{unified:'stop' as const,raw:undefined},usage,warnings:[]});
const call={content:[{type:'tool-call' as const,toolCallId:'call_1',toolName:'readHistory',input:'{}'}],finishReason:{unified:'tool-calls' as const,raw:undefined},usage,warnings:[]};
const callEvidence={...call,content:[{type:'tool-call' as const,toolCallId:'call_2',toolName:'readEvidence',input:'{}'}]};
const output=(evidenceIds:string[])=>JSON.stringify({suggestions:[{title:'Investigate',detail:'Review the observed funnel.',type:'hypothesis',priority:'medium',topic:'gameplay',evidenceIds}]});
beforeAll(()=>{process.env.LOCAL_DATABASE_PATH='memory://';});
describe('bounded AI research and history',()=>{
  it('uses a real SDK tool step and rejects invented evidence',async()=>{
    const history=await loadAgentHistory('agent_ws','g');
    const model=new MockLanguageModelV4({doGenerate:[call,callEvidence,finish(output(['history']))]});
    const result=await interpretResearch({model,gameId:'g',findings:[],history});
    expect(result).toHaveLength(1); expect(model.doGenerateCalls).toHaveLength(3);
    expect(JSON.stringify(model.doGenerateCalls[1].prompt)).toContain('Social impressions and likes are unavailable');
    const invented=new MockLanguageModelV4({doGenerate:[call,callEvidence,finish(output(['made_up']))]});
    expect(await interpretResearch({model:invented,gameId:'g',findings:[],history})).toEqual([]);
    expect(()=>anthropicModel({token:'',model:'x'})).toThrow();
  });
  it('stops repeated tool calls at four steps and propagates provider errors',async()=>{
    const history=await loadAgentHistory('agent_ws','g');
    const repeat=new MockLanguageModelV4({doGenerate:async()=>call});
    await expect(interpretResearch({model:repeat,gameId:'g',findings:[],history})).rejects.toThrow();
    expect(repeat.doGenerateCalls).toHaveLength(4);
    const failed=new MockLanguageModelV4({doGenerate:async()=>{throw new Error('offline');}});
    await expect(interpretResearch({model:failed,gameId:'g',findings:[],history})).rejects.toThrow('offline');
    expect(failed.doGenerateCalls).toHaveLength(1);
  });
  it('keeps scoped human history fresh and passes it into draft prompts',async()=>{
    const {put,query}=await import('../src/lib/db');
    await put('agent_ws','post',{id:'p1',gameId:'g',text:'Original edited draft',channel:'x',status:'draft',createdAt:new Date().toISOString(),campaignId:'campaign'});
    await put('agent_ws','post',{id:'p2',gameId:'other',text:'FOREIGN_GAME_SENTINEL',channel:'x',status:'published',createdAt:new Date().toISOString(),campaignId:'other'});
    await put('foreign_ws','post',{id:'p3',gameId:'g',text:'FOREIGN_WORKSPACE_SENTINEL',channel:'x',status:'published',createdAt:new Date().toISOString(),campaignId:'other'});
    await query(`INSERT INTO events(id,workspace_id,game_id,session_id,player_id,kind,name,occurred_at,country,device,source,campaign,page,properties) VALUES ('e1','agent_ws','g','PRIVATE_SESSION','PRIVATE_PLAYER','human','visit',now(),'','','','campaign','','{}'),('e2','agent_ws','other','s','p','human','visit',now(),'','','','other','','{}'),('e3','agent_ws','g','s2','p2','agent','visit',now(),'','','','other','','{}')`);
    const first=await loadAgentHistory('agent_ws','g');
    const json=JSON.stringify(first); expect(first.totals.visits).toBe(1); expect(json).toContain('Original edited draft');
    for(const secret of ['FOREIGN_GAME_SENTINEL','FOREIGN_WORKSPACE_SENTINEL','PRIVATE_SESSION','PRIVATE_PLAYER']) expect(json).not.toContain(secret);
    expect(json).toContain('neither successes nor evidence of rejection');
    const fetchMock=vi.fn().mockImplementation(async()=>new Response(JSON.stringify({id:'msg',type:'message',role:'assistant',model:'test',content:[{type:'text',text:'Draft'}],stop_reason:'end_turn',stop_sequence:null,usage:{input_tokens:1,output_tokens:1}}),{headers:{'content-type':'application/json'}}));
    vi.stubGlobal('fetch',fetchMock);
    try {
      await draftContent({game,channel:'x',secret:{token:'test',model:'test'},history:first});
      await put('agent_ws','post',{id:'p4',gameId:'g',text:'Freshly edited version',channel:'x',status:'draft',createdAt:new Date().toISOString(),campaignId:'new'});
      const fresh=await loadAgentHistory('agent_ws','g');
      await draftContent({game,channel:'x',secret:{token:'test',model:'test'},history:fresh});
      const firstBody=String(fetchMock.mock.calls[0][1].body), secondBody=String(fetchMock.mock.calls[1][1].body);
      expect(firstBody).not.toContain('Freshly edited version'); expect(secondBody).toContain('Freshly edited version');
      const request=JSON.parse(secondBody);
      expect(JSON.stringify(request.system)).not.toContain('Freshly edited version');
      expect(JSON.stringify(request.messages)).toContain('Freshly edited version');
    } finally {vi.unstubAllGlobals();}
  });
  it('keeps post and measurement slots available when findings are numerous',async()=>{
    const {put}=await import('../src/lib/db');
    for(let i=0;i<40;i++) await put('saturation','finding',{id:`f${i}`,gameId:'g',title:'Finding',detail:'Observation',type:'observation',status:'open',evidence:[],createdAt:new Date().toISOString()});
    await put('saturation','post',{id:'p',gameId:'g',text:'POST_REMAINS',channel:'x',status:'draft',createdAt:new Date().toISOString(),campaignId:'campaign'});
    await put('saturation','measurement',{id:'m',gameId:'g',findingId:'f0',note:'MEASUREMENT_REMAINS',startedAt:new Date().toISOString(),baseline:{sessions:0,starts:0,completions:0,errorSessions:0}});
    const history=await loadAgentHistory('saturation','g');
    expect(history.findings).toHaveLength(30); expect(history.posts[0].text).toBe('POST_REMAINS');
    expect(history.measurements[0].note).toBe('MEASUREMENT_REMAINS');
  });

});

describe('profile projection',()=>{
  it('bounds same-game facts and edits, excludes fixture, private references and foreign records',async()=>{
    const {put}=await import('../src/lib/db');
    await put('projection','game_profile_overrides',{id:'g',overrides:{controls:'x'.repeat(1200),rules:'Use arrows session_private',secret:'BAD_EXTRA'}});
    await put('projection','game_profile',{id:'g',facts:[...Array.from({length:25},()=>({label:'L'.repeat(150),value:'v'.repeat(700),evidence:{source:'Public page metadata',observedAt:'2026-10-01T00:00:00.000Z',url:'https://private.example',recordingId:'rec-private'}})),{label:'fixture',value:'FIXTURE_SENTINEL',evidence:{source:'Controlled fixture metadata'}}]});
    await put('projection','game_profile',{id:'other',facts:[{label:'foreign',value:'FOREIGN_GAME',evidence:{source:'Public page metadata'}}]});
    await put('foreign_projection','game_profile_overrides',{id:'g',overrides:{rules:'FOREIGN_WORKSPACE'}});
    const h=await loadAgentHistory('projection','g');
    expect(h.profile.facts).toHaveLength(20); expect(h.profile.facts[0].label).toHaveLength(100); expect(h.profile.facts[0].value).toHaveLength(600); expect(h.profile.overrides.controls).toHaveLength(1000);
    const json=JSON.stringify(h.profile); for(const secret of ['session_private','private.example','rec-private','FOREIGN_GAME','FOREIGN_WORKSPACE','FIXTURE_SENTINEL','BAD_EXTRA']) expect(json).not.toContain(secret);
  });
});
