import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as db from "../src/lib/db";
import { createReleaseMeasurement, measurementResults } from "../src/lib/measurements";
import { validateMeasurementWindows, measurementMetrics } from "../src/lib/measurement-outcomes";
import { sqlAnalytics } from "../src/lib/analytics-sql";

const now = Date.parse("2026-10-28T12:00:00.000Z");
const input = {findingId:"finding",gameId:"game",note:"Changed onboarding",release:{version:"v2",description:"Reduced setup steps",evidenceUrl:"https://example.com/releases/v2",effectiveAt:"2026-10-26T12:00:00.000Z"},baselineWindow:{start:"2026-10-24T12:00:00.000Z",end:"2026-10-26T12:00:00.000Z"},followupWindow:{start:"2026-10-26T12:00:00.000Z",end:"2026-10-29T12:00:00.000Z"}};
let serial=0;
async function event(name:string, session:string, player:string, time:string, options:{workspace?:string;game?:string;kind?:string;properties?:object}={}) {
 const workspace=options.workspace||"owner",game=options.game||"game",kind=options.kind||"human";
 await db.query(`INSERT INTO events(id,workspace_id,game_id,session_id,player_id,kind,name,occurred_at,received_at,country,device,source,campaign,page,properties) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'NG','mobile','direct','','',$10::jsonb)`,[`e${++serial}`,workspace,game,session,player,kind,name,time,time,JSON.stringify(options.properties||{})]);
 if(kind==='human') await db.query(`INSERT INTO player_first_seen(workspace_id,game_id,player_id,first_at,first_session_id) VALUES($1,$2,$3,$4,$5) ON CONFLICT(workspace_id,game_id,player_id) DO UPDATE SET first_at=excluded.first_at,first_session_id=excluded.first_session_id WHERE (excluded.first_at,excluded.first_session_id)<(player_first_seen.first_at,player_first_seen.first_session_id)`,[workspace,game,player,time,session]);
}
beforeAll(async()=>{
 delete process.env.DATABASE_URL; delete process.env.VERCEL; process.env.LOCAL_DATABASE_PATH="memory://";
 await db.put("owner","finding",{id:"finding",gameId:"game"});
 await event("visit","a","p","2026-10-25T12:00:00.000Z");
 await event("loaded","a","p","2026-10-25T12:00:01.000Z");
 await event("round_start","a","p","2026-10-25T12:00:02.000Z");
 await event("active_play","a","p","2026-10-25T12:00:03.000Z",{properties:{duration:20}});
 await event("round_complete","a","p","2026-10-25T12:00:04.000Z");
 await event("visit","return","p","2026-10-26T14:00:00.000Z");
 await event("visit","agent","agent","2026-10-26T14:00:00.000Z",{kind:"agent"});
 await event("visit","foreign","foreign","2026-10-26T14:00:00.000Z",{workspace:"other"});
 await event("visit","wrong-game","x","2026-10-26T14:00:00.000Z",{game:"another"});
});
afterAll(async()=>{await db.closeDatabase();});
describe("release measurements",()=>{
 it("validates actual releases and half-open windows",()=>{
  expect(()=>validateMeasurementWindows(input.release,input.baselineWindow,input.followupWindow,now)).not.toThrow();
  expect(()=>validateMeasurementWindows({...input.release,effectiveAt:"2026-10-29T12:00:00.000Z"},input.baselineWindow,input.followupWindow,now)).toThrow();
  expect(()=>validateMeasurementWindows(input.release,input.baselineWindow,{...input.followupWindow,start:"2026-10-26T11:00:00.000Z"},now)).toThrow();
  expect(()=>validateMeasurementWindows(input.release,{...input.baselineWindow,start:input.baselineWindow.end},input.followupWindow,now)).toThrow();
  expect(()=>validateMeasurementWindows({...input.release,evidenceUrl:"javascript:alert(1)"},input.baselineWindow,input.followupWindow,now)).toThrow();
  expect(()=>validateMeasurementWindows({...input.release,effectiveAt:"2026-10-26"},input.baselineWindow,input.followupWindow,now)).toThrow();
 });
 it("rejects a finding from another workspace or game",async()=>{
  await expect(createReleaseMeasurement("other",input,now)).rejects.toThrow("Finding not found");
  await expect(createReleaseMeasurement("owner",{...input,gameId:"another"},now)).rejects.toThrow("Finding not found");
 });
 it("matches dashboard human totals and active play while respecting half-open boundaries",async()=>{
  const a=await measurementMetrics("owner","game",input.baselineWindow.start,input.baselineWindow.end,new Date(now).toISOString());
  const dashboard=await sqlAnalytics("owner","game",2,Date.parse(input.baselineWindow.end));
  expect(a).toMatchObject({players:1,sessions:1,starts:1,completions:1,activePlay:{totalSeconds:15,measuredSessions:1,eligibleSessions:1},completion:{numerator:1,denominator:1,rate:1},conversion:{numerator:1,denominator:1,rate:1},d1:{cohortPlayers:1,eligible:1,returned:1,rate:1}});
  expect({sessions:a.sessions,starts:a.starts,completions:a.completions,activePlay:a.activePlay.totalSeconds}).toEqual({sessions:dashboard.sessions,starts:dashboard.starts,completions:dashboard.completions,activePlay:dashboard.activePlay?.totalSeconds});
 });
 it("assigns a boundary event only to the follow-up window",async()=>{
  await event("visit","edge","edge","2026-10-26T12:00:00.000Z");
  const before=await measurementMetrics("owner","game",input.baselineWindow.start,input.baselineWindow.end,new Date(now).toISOString());
  const after=await measurementMetrics("owner","game",input.followupWindow.start,new Date(now).toISOString(),new Date(now).toISOString());
  expect(before.sessions).toBe(1); expect(after.sessions).toBe(2);
 });
 it("turns a recorded change and mature human observations into a reviewable next action",async()=>{
  const workspace="controlled";
  const reviewedAt=Date.parse("2026-11-01T12:00:00.000Z");
  await db.put(workspace,"finding",{id:"finding",gameId:"game"});
  for (let i=0;i<30;i++) {
   const player=`before-${i}`, session=`before-${i}`;
   await event("visit",session,player,"2026-10-25T12:00:00.000Z",{workspace});
   await event("loaded",session,player,"2026-10-25T12:00:01.000Z",{workspace});
   await event("round_start",session,player,"2026-10-25T12:00:02.000Z",{workspace});
   await event("active_play",session,player,"2026-10-25T12:00:03.000Z",{workspace,properties:{duration:10}});
   const after=`after-${i}`;
   await event("visit",after,after,"2026-10-27T12:00:00.000Z",{workspace});
   await event("loaded",after,after,"2026-10-27T12:00:01.000Z",{workspace});
   if (i<10) {
    await event("round_start",after,after,"2026-10-27T12:00:02.000Z",{workspace});
    await event("active_play",after,after,"2026-10-27T12:00:03.000Z",{workspace,properties:{duration:10}});
   }
  }
  await event("visit","synthetic","synthetic","2026-10-27T13:00:00.000Z",{workspace,kind:"agent"});
  const record=await createReleaseMeasurement(workspace,input,reviewedAt);
  const result=(await measurementResults(workspace,"game",reviewedAt)).find(x=>x.id===record.id)!;
  expect(result.outcome).toMatchObject({mature:true,releaseEvidence:"owner_reported",baseline:{sessions:30,conversion:{numerator:30,denominator:30,rate:1}},followup:{sessions:30,conversion:{numerator:10,denominator:30},d1:{cohortPlayers:30,eligible:30}}});
  expect(result.outcome?.nextAction).toMatch(/Investigate the conversion rate/);
  expect(result.outcome?.caveats.join(" ")).toMatch(/cannot establish/);
 });
 it("records release and reports immature, low data, coverage and separate legacy context",async()=>{
  await createReleaseMeasurement("owner",input,now);
  await db.put("owner","measurement",{id:"old",gameId:"game",findingId:"finding",note:"Clicked",startedAt:input.release.effectiveAt,baseline:{sessions:1,starts:1,completions:0,errorSessions:0}});
  const results=await measurementResults("owner","game",now);
  const release=results.find(m=>m.releaseContextStatus==="recorded")!;
  expect(release.outcome).toMatchObject({mature:false,followup:{players:2,sessions:2,returningPlayers:1}});
  expect(release.outcome?.caveats.join(" ")).toMatch(/still in progress/);
  expect(release.outcome?.caveats.join(" ")).toMatch(/Low session counts/);
  expect(results.find(m=>m.id==="old")?.releaseContextStatus).toBe("missing");
  expect(await measurementResults("other","game",now)).toEqual([]);
 });
});
