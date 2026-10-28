import { afterAll, beforeAll, expect, it } from "vitest";
import type { Game } from "../src/lib/types";
import { ingest } from "../src/lib/telemetry";
import { sqlAnalytics } from "../src/lib/analytics-sql";
import { closeDatabase, put, query } from "../src/lib/db";

const game: Game = { id:"active-game",title:"Active",url:"https://game.example",description:"",image:"",genre:"",sdkKey:"sdk_active_play_1234567890123456",origins:["https://game.example"],createdAt:new Date().toISOString(),dailyEnabled:false,competitors:[] };
const base = Math.floor((Date.now()-120000)/15000)*15000;
let serial = 0;
function request(name:string, session:string, at:number, properties:Record<string,unknown> = {}) {
  return new Request("https://studio.example/api/collect", {method:"POST",headers:{Origin:"https://game.example","Content-Type":"application/json"},body:JSON.stringify({sdkKey:game.sdkKey,events:[{id:`event-${++serial}-abcdefghijkl`,name,sessionId:session,playerId:`player-${session}`,timestamp:new Date(at).toISOString(),properties}]})});
}
async function send(name:string, session:string, at:number, properties:Record<string,unknown> = {}) { return (await ingest(request(name,session,at,properties))).json(); }
beforeAll(async()=>{ delete process.env.DATABASE_URL;delete process.env.VERCEL;process.env.LOCAL_DATABASE_PATH="memory://";await put("active-workspace","game",game); });
afterAll(async()=>{await closeDatabase();});

it("caps, deduplicates and scopes heartbeat measurements while preserving unknown historical sessions",async()=>{
  const one="session-one",two="session-two",old="session-old";
  await send("visit",one,base); await send("loaded",one,base+10); await send("round_start",one,base+20);
  expect(await send("active_play",one,base+30,{duration:0})).toEqual({accepted:1});
  expect(await send("active_play",one,base+1000,{duration:15})).toEqual({accepted:1});
  expect(await send("active_play",one,base+2000,{duration:15})).toEqual({accepted:0});
  expect(await send("active_play",one,base+16000,{duration:999})).toEqual({accepted:0});
  expect(await send("active_play",one,base+16001,{duration:-1})).toEqual({accepted:0});
  expect(await send("active_play",one,base+16002,{duration:1.5})).toEqual({accepted:0});
  await send("progression",one,base+16003,{step:"level_1"}); await send("retry",one,base+16004); await send("error",one,base+16005);
  await send("round_complete",one,base+16006);
  await send("active_play",one,base+31000,{duration:15});
  await send("visit",two,base+100); await send("round_start",two,base+200); await send("active_play",two,base+300,{duration:0});
  await send("visit",old,base+100); await send("round_start",old,base+200);
  const synthetic = await ingest(request("active_play","agent-session",base+1000,{duration:15}),{workspace:"active-workspace",game,recordingId:"rec_agent_session"});
  expect(await synthetic.json()).toEqual({accepted:0});
  const result=await sqlAnalytics("active-workspace",game.id,14,Date.now()+1000);
  expect(result.activePlay).toEqual({totalSeconds:15,averageSeconds:7.5,medianSeconds:7.5,measuredSessions:2,eligibleSessions:3});
  expect(result).toMatchObject({loadedSessions:1,progressionSessions:1,replays:1,errorSessions:1});
  expect(result.sessionsList.find(s=>s.id===one)).toMatchObject({activePlaySeconds:15,lastStep:"level_1"});
  expect(result.sessionsList.find(s=>s.id===two)?.activePlaySeconds).toBe(0);
  expect(result.sessionsList.find(s=>s.id===old)?.activePlaySeconds).toBeNull();
  expect(await query("SELECT id FROM events WHERE name='active_play' AND kind='agent'")).toEqual([]);
});

it("returns null totals when no sessions have active-play coverage",async()=>{
  const result=await sqlAnalytics("other-workspace",undefined,14,Date.now()+1000);
  expect(result.activePlay).toEqual({totalSeconds:null,averageSeconds:null,medianSeconds:null,measuredSessions:0,eligibleSessions:0});
});
