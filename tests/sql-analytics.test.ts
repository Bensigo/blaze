import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { sqlAnalytics, querySessionPage } from "../src/lib/analytics-sql";
import { summarize, type EventRow } from "../src/lib/analytics";
import * as db from "../src/lib/db";

const now=Date.parse("2026-10-28T12:00:00.000Z");
const base=now-3*86400000;
let serial=0;
const rows:EventRow[]=[];
async function add(name:string, session:string, offset:number, extra:Partial<EventRow> & {workspace?:string}={}) {
 const e:EventRow={id:`event-${String(++serial).padStart(5,"0")}`,game_id:"game-a",session_id:session,player_id:"player-a",kind:"human",name,occurred_at:new Date(base+offset).toISOString(),country:"NG",device:"mobile",source:"x",campaign:"launch",page:"",properties:{},...extra};
 await db.query(`INSERT INTO events(id,workspace_id,game_id,session_id,player_id,kind,name,occurred_at,country,device,source,campaign,page,properties,received_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15)`,[e.id,extra.workspace||"w",e.game_id,e.session_id,e.player_id,e.kind,e.name,e.occurred_at,e.country,e.device,e.source,e.campaign,e.page,JSON.stringify(e.properties),new Date(now-1000).toISOString()]);
 if (e.kind==='human') await db.query(`INSERT INTO player_first_seen(workspace_id,game_id,player_id,first_at,first_session_id) VALUES($1,$2,$3,$4,$5) ON CONFLICT(workspace_id,game_id,player_id) DO UPDATE SET first_at=excluded.first_at,first_session_id=excluded.first_session_id WHERE (excluded.first_at,excluded.first_session_id)<(player_first_seen.first_at,player_first_seen.first_session_id)`,[extra.workspace||"w",e.game_id,e.player_id,e.occurred_at,e.session_id]);
 if (!extra.workspace) rows.push(e);
}
beforeAll(async()=>{ delete process.env.DATABASE_URL; delete process.env.VERCEL; process.env.LOCAL_DATABASE_PATH="memory://";
 await add("visit","first",0);
 await add("loaded","first",1000);
 await add("round_complete","first",2000);
 await add("first_action","first",3000);
 await add("round_start","first",4000);
 await add("retry","first",5000);
 await add("progression","first",6000,{properties:{step:"level_1"}});
 await add("pointer","first",7000,{properties:{x:1,y:0}});
 await add("visit","second",26*3600000);
 await add("error","second",26*3600000+1000);
 await add("visit","agent",100,{kind:"agent"});
 await add("visit","future",now-base+1,{kind:"agent"});
 await add("visit","out",-20*86400000,{workspace:"other"});
});
afterAll(async()=>{await db.closeDatabase();});
describe("SQL analytics on Postgres",()=>{
 it("counts both observed action orders and separates views and starts with no action",async()=>{
  const workspace="funnel-order";
  const record=async (session:string, names:string[], offset:number, kind:"human"|"agent"="human")=>{
   for(const [index,name] of names.entries()) await add(name,session,offset+index*100,{workspace,player_id:`player-${session}`,kind});
  };
  await record("whot",["visit","loaded","round_start","first_action","round_complete","retry"],1000);
  await record("action-first",["visit","loaded","first_action","round_start","round_complete"],3000);
  await record("action-before-loaded",["visit","first_action","loaded","round_start","round_complete"],5000);
  await record("view-only",["visit","loaded"],7000);
  await record("start-no-action",["visit","loaded","round_start"],9000);
  await record("too-early-completion",["visit","loaded","round_complete","round_start","first_action"],11000);
  await record("agent",["visit","loaded","round_start","first_action","round_complete"],13000,"agent");
  const actual=await sqlAnalytics(workspace,"game-a",14,now);
  const events=await db.query<EventRow>("SELECT * FROM events WHERE workspace_id=$1",[workspace]);
  const expected=summarize(events,new Map(),14,now);
  expect(actual.funnel).toEqual([
    {name:"Visit",count:6},{name:"Loaded",count:6},{name:"Round started",count:5},
    {name:"First action",count:4},{name:"Round completed",count:3},
  ]);
  expect(actual.funnel).toEqual(expected.funnel);
  expect(actual.launch?.coverage).toEqual(expected.launch?.coverage);
  expect(actual).toMatchObject({sessions:6,starts:5,firstActions:4,completions:4,replays:1,syntheticSessions:1});
  expect(actual.dropoffs).toEqual(expect.arrayContaining([{name:"Viewed, no round start",count:1},{name:"Started, no first action",count:1}]));
 });
 it("matches the pure summary for human totals, ordered funnel, retention and heatmap",async()=>{
  const a=await sqlAnalytics("w","game-a",14,now);
  const expected=summarize(rows.filter(e=>new Date(e.occurred_at).getTime()<=now),new Map([["player-a",base]]),14,now,new Map([["player-a","first"]]));
  for(const key of ["sessions","players","starts","completions","replays","returns","errorSessions","firstActions","syntheticSessions","trend","funnel","retention","campaigns"] as const) expect(a[key],key).toEqual(expected[key]);
  expect(a.heatmap).toEqual([{gameId:"game-a",surface:"viewport",screen:"unknown",device:"mobile",bx:19,by:0,x:0.975,y:0.025,count:1}]);
  expect(a.sessionsList[0]).toMatchObject({id:"second",lastStep:"error"});
 });
 it("counts all sessions with stable complete pages and scopes same identities by game and workspace",async()=>{
  for(let i=0;i<112;i++) await add("visit",`s-${String(i).padStart(3,"0")}`,i+10000,{player_id:`p-${i}`,campaign:""});
  await add("visit","first",20000,{game_id:"game-b"});
  await add("visit","foreign",0,{workspace:"other"});
  const a=await sqlAnalytics("w",undefined,14,now);
  expect(a.sessions).toBe(115); expect(a.players).toBe(114); expect(a.sessionsList).toHaveLength(100);
  const first=await querySessionPage("w",undefined,14,{now,limit:47});
  const second=await querySessionPage("w",undefined,14,{cursor:first.nextCursor,limit:47});
  const third=await querySessionPage("w",undefined,14,{cursor:second.nextCursor,limit:47});
  const ids=[...first.sessions,...second.sessions,...third.sessions].map(s=>`${s.gameId}/${s.id}`);
  expect(first.total).toBe(115);expect(ids).toHaveLength(115);expect(new Set(ids).size).toBe(115);expect(third.nextCursor).toBeUndefined();
  await expect(querySessionPage("other",undefined,14,{cursor:first.nextCursor})).rejects.toThrow("Invalid session cursor");
 });
 it("uses exact inclusive window bounds, game-scoped cohorts and excludes visits at the 48 hour edge",async()=>{
  const w="bound";
  const firstTime=now-3*86400000;
  await add("visit","first",0,{workspace:w,game_id:"A",player_id:"same"});
  await add("visit","return",24*3600000,{workspace:w,game_id:"A",player_id:"same"});
  await add("visit","first",0,{workspace:w,game_id:"B",player_id:"same"});
  await add("visit","too-late",48*3600000,{workspace:w,game_id:"B",player_id:"same"});
  await add("visit","cutoff",0,{workspace:w,player_id:"edge",occurred_at:new Date(now-14*86400000).toISOString()});
  await add("visit","before",0,{workspace:w,player_id:"before",occurred_at:new Date(now-14*86400000-1).toISOString()});
  await add("visit","at-now",0,{workspace:w,player_id:"now",occurred_at:new Date(now).toISOString()});
  await add("visit","after-now",0,{workspace:w,player_id:"future",occurred_at:new Date(now+1).toISOString()});
  const result=await sqlAnalytics(w,undefined,14,now);
  expect(result.sessions).toBe(6); expect(result.players).toBe(4);
  expect(result.returns).toBe(2);
  expect(result.retention.find(r=>r.date===new Date(firstTime).toISOString().slice(0,10))).toMatchObject({players:2,eligible:2,returned:1,rate:0.5});
 });
 it("retains microsecond ordering across cursor pages with tied session names",async()=>{
  const w="precision";
  await add("visit","one",0,{workspace:w,occurred_at:"2026-10-27T10:00:00.000001Z"});
  await add("visit","two",0,{workspace:w,occurred_at:"2026-10-27T10:00:00.000002Z"});
  await add("visit","three",0,{workspace:w,occurred_at:"2026-10-27T10:00:00.000002Z"});
  const p1=await querySessionPage(w,undefined,14,{now,limit:1});
  const p2=await querySessionPage(w,undefined,14,{cursor:p1.nextCursor,limit:1});
  const p3=await querySessionPage(w,undefined,14,{cursor:p2.nextCursor,limit:1});
  expect([p1.sessions[0].id,p2.sessions[0].id,p3.sessions[0].id]).toEqual(["three","two","one"]);
  expect(p3.nextCursor).toBeUndefined();
 });
 it("reports the number of omitted breakdown groups",async()=>{
  for(let i=0;i<52;i++) await add("visit",`session-${i}`,i,{workspace:"coverage",player_id:`player-${i}`,country:`country-${i}`,campaign:`campaign-${i}`});
  const result=await sqlAnalytics("coverage",undefined,14,now);
  expect(result.countries).toHaveLength(50);
  expect(result.coverage?.countries).toEqual({shown:50,total:52});
  expect(result.coverage?.campaigns).toEqual({shown:52,total:52});
 });

 it("keeps late arrivals out of existing pages and includes them after refresh",async()=>{
  const w="late-page";
  await add("visit","one",0,{workspace:w,occurred_at:"2026-10-27T10:00:00.000Z"});
  await add("visit","two",0,{workspace:w,occurred_at:"2026-10-27T11:00:00.000Z"});
  const p1=await querySessionPage(w,undefined,14,{now,limit:1});
  await db.query(`INSERT INTO events(id,workspace_id,game_id,session_id,player_id,kind,name,occurred_at,received_at,country,device,source,campaign,page,properties) VALUES('late-event',$1,'game-a','late','late-player','human','visit','2026-10-27T10:30:00Z',$2,'NG','mobile','x','','','{}'::jsonb)`,[w,new Date(now+1000).toISOString()]);
  const p2=await querySessionPage(w,undefined,14,{cursor:p1.nextCursor,limit:1});
  expect([p1.sessions[0].id,p2.sessions[0].id]).toEqual(["two","one"]);
  expect(p2.total).toBe(2);expect(p2.nextCursor).toBeUndefined();
  const fresh=await querySessionPage(w,undefined,14,{now:now+2000});
  expect(fresh.sessions.map(s=>s.id)).toEqual(["two","late","one"]);
 });

 it("uses event ID for equal timestamps and the last progression for dropoff",async()=>{
  const w="ties";
  await add("loaded","tie",0,{workspace:w});
  await add("visit","tie",0,{workspace:w});
  await add("progression","tie",1000,{workspace:w,properties:{step:"level-1"}});
  await add("progression","tie",2000,{workspace:w,properties:{step:12}});
  await add("exit","tie",3000,{workspace:w});
  const result=await sqlAnalytics(w,undefined,14,now);
  expect(result.funnel.map(f=>f.count)).toEqual([1,0,0,0,0]);
  expect(result.sessionsList[0].lastStep).toBe("progression");
 });

});

it('audience links only scoped consented IDs and separates volunteered answers from network country',async()=>{
 const workspace='audience-proof',player='scoped_forever_browser-one';
 await add('visit','a',100,{workspace,player_id:player,country:'GB'});
 await add('round_start','a',200,{workspace,player_id:player});
 await add('round_start','b',300,{workspace,player_id:player,game_id:'game-b'});
 await add('player_profile','b',400,{workspace,player_id:player,game_id:'game-b',properties:{age_band:'25-34',declared_country:'NG',interests:'sports,puzzle'}});
 await add('visit','old',500,{workspace,player_id:'old-key-specific'});
 await add('visit','test',600,{workspace,player_id:'scoped_forever_test',properties:{test:true}});
 await add('round_start','test',700,{workspace,player_id:'scoped_forever_test'});
 const {audience}=await import('../src/lib/audience');const result=await audience(workspace,undefined,14,now);
 expect(result).toMatchObject({browserIds:1,unlinkedGameBrowserIds:1,profileRespondents:1,countries:[{name:'GB',count:1}],ageBands:[{name:'25-34',count:1}],declaredCountries:[{name:'NG',count:1}]});
 expect(result.segments).toContainEqual({name:'Multiple games',count:1});
 expect(result.interests).toEqual([{name:'puzzle',count:1},{name:'sports',count:1}]);
 await add('player_profile','b',800,{workspace,player_id:player,game_id:'game-b',properties:{age_band:'unknown',declared_country:'unknown',interests:'unknown'}});
 const removed=await audience(workspace,undefined,14,now);expect(removed.profileRespondents).toBe(0);expect(removed.ageBands).toEqual([]);
 expect((await audience('unrelated',undefined,14,now)).browserIds).toBe(0);
});
