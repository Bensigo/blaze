import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import * as db from "../src/lib/db";
import * as auth from "../src/lib/auth";
import { sqlAnalytics, investigateSessions } from "../src/lib/analytics-sql";
import { summarize, type EventRow } from "../src/lib/analytics";
import { ingest } from "../src/lib/telemetry";
import { GET } from "../src/app/api/investigation/route";
import type { Game, SessionCapture } from "../src/lib/types";
const now=Date.now(), base=now-120000;
const user={id:"u1",email:"u@example.test",name:"Owner",workspace_id:"w1"};
let serial=0;
async function add(workspace:string,game:string,session:string,name:string,time:number,properties:Record<string,unknown>={},device="mobile",kind="human") {
  const id=`e-${String(++serial).padStart(6,"0")}`;
  await db.query(`INSERT INTO events(id,workspace_id,game_id,session_id,player_id,kind,name,occurred_at,received_at,country,device,source,campaign,page,properties) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'NG',$10,'Direct','','',$11::jsonb)`,[id,workspace,game,session,`p-${session}`,kind,name,new Date(time).toISOString(),new Date(time).toISOString(),device,JSON.stringify(properties)]);
  return id;
}
async function seedCapture(session:string,id:string,recordedAt:number) {
 const capture={id,gameId:"game-a",sessionId:session,status:"ready",videoUrl:"/private",recordedAt:new Date(recordedAt).toISOString(),durationSeconds:10,expiresAt:new Date(now+3600000).toISOString(),segment:0} as SessionCapture;
 await db.put("w1","session_capture",capture);
}
beforeAll(async()=>{delete process.env.DATABASE_URL;delete process.env.VERCEL;process.env.LOCAL_DATABASE_PATH="memory://";
 for(const session of ["s1","s2","s3","s4","s5","old"]) await add("w1","game-a",session,"visit",base);
 await add("w1","game-a","s1","loaded",base+1000); await add("w1","game-a","s1","round_start",base+2000);
 await add("w1","game-a","s1","pointer",base+3000,{x:.21,y:.32,surface:"game",screen:"lobby"});
 await add("w1","game-a","s1","pointer",base+4000,{x:.22,y:.33,surface:"game",screen:"lobby"});
 await add("w1","game-a","s2","pointer",base+3000,{x:.21,y:.32,surface:"game",screen:"lobby"});
 await add("w1","game-a","s3","pointer",base+3000,{x:.21,y:.32,surface:"game",screen:"battle"});
 await add("w1","game-a","s4","pointer",base+3000,{x:.21,y:.32,surface:"game",screen:"lobby"},"desktop");
 await add("w1","game-a","s5","pointer",base+3000,{x:.21,y:.32,surface:"viewport",screen:"viewport"});
 await add("w1","game-a","old","pointer",base+3000,{x:.21,y:.32});
 await add("w1","game-b","other-game","pointer",base+3000,{x:.21,y:.32,surface:"game",screen:"lobby"});
 await add("w2","game-a","other-workspace","pointer",base+3000,{x:.21,y:.32,surface:"game",screen:"lobby"});
 await add("w1","game-a","synthetic","pointer",base+3000,{x:.21,y:.32,surface:"game",screen:"lobby"},"mobile","agent");
 await add("w1","game-a","s3","pointer",base+5000,{x:2,y:0,surface:"game",screen:"battle"});
 await seedCapture("s1","cap-covered",base+2000); await seedCapture("s2","cap-gap",base-30000);
});
beforeEach(()=>{vi.restoreAllMocks();vi.spyOn(auth,"requireIdentity").mockResolvedValue(user);});
afterAll(async()=>{vi.restoreAllMocks();await db.closeDatabase();});

it("separates surface, screen, device and game and labels legacy samples",async()=>{
 const result=await sqlAnalytics("w1","game-a",14,now);
 expect(result.heatmap).toEqual(expect.arrayContaining([
  expect.objectContaining({surface:"game",screen:"lobby",device:"mobile",bx:4,by:6,count:3}),
  expect.objectContaining({surface:"game",screen:"lobby",device:"desktop",bx:4,by:6,count:1}),
  expect.objectContaining({surface:"game",screen:"battle",device:"mobile",bx:4,by:6,count:1}),
  expect.objectContaining({surface:"viewport",screen:"viewport",device:"mobile",bx:4,by:6,count:1}),
  expect.objectContaining({surface:"viewport",screen:"unknown",device:"mobile",bx:4,by:6,count:1}),
 ]));
 expect(result.heatmap).toHaveLength(5);
 const rows=await db.query<EventRow>("SELECT * FROM events WHERE workspace_id='w1' AND game_id='game-a'");
 const pure=summarize(rows,new Map(),14,now);
 expect(pure.heatmap).toEqual(expect.arrayContaining(result.heatmap));
 expect(pure.heatmap).toHaveLength(result.heatmap.length);
});

it("finds matching sessions and links only a covered event to replay",async()=>{
 const filter={kind:"heatmap" as const,gameId:"game-a",surface:"game" as const,screen:"lobby",device:"mobile",bx:4,by:6};
 const result=await investigateSessions("w1",filter,14,now);
 expect(result.results).toHaveLength(2);expect(result.hasMore).toBe(false);
 const one=result.results.find(r=>r.session.id==="s1")!,two=result.results.find(r=>r.session.id==="s2")!;
 expect(one.evidence).toMatchObject({name:"pointer",timestamp:new Date(base+4000).toISOString(),replay:{captureId:"cap-covered",offsetSeconds:2}});
 expect(two.evidence.replay).toBeUndefined();
 expect(JSON.stringify(result)).not.toContain("/private");
 expect((await investigateSessions("w2",filter,14,now)).results.map(r=>r.session.id)).toEqual(["other-workspace"]);
 expect((await investigateSessions("w1",{...filter,gameId:"game-b"},14,now)).results.map(r=>r.session.id)).toEqual(["other-game"]);
 expect((await investigateSessions("w1",filter,14,base+3500)).results.find(r=>r.session.id==="s1")?.evidence.timestamp).toBe(new Date(base+3000).toISOString());
});

it("connects distinct drop-off categories to observed session events",async()=>{
 const noAction=await investigateSessions("w1",{kind:"dropoff",gameId:"game-a",dropoff:"Started, no first action"},14,now);
 expect(noAction.results.map(r=>r.session.id)).toEqual(["s1"]);
 expect(noAction.results[0].evidence.name).toBe("round_start");
 const noStart=await investigateSessions("w1",{kind:"dropoff",gameId:"game-a",dropoff:"Viewed, no round start"},14,now);
 expect(noStart.results.map(r=>r.session.id)).toEqual(expect.arrayContaining(["s2","s3","s4","s5","old"]));
 const unknown=await investigateSessions("w1",{kind:"dropoff",gameId:"game-b",dropoff:"Unknown"},14,now);
 expect(unknown.results).toHaveLength(1); expect(unknown.results[0].session.lastStep).toBe("Unknown"); expect(unknown.results[0].evidence.name).toBe("pointer");
});

it("bounds owner-visible results and rejects bad filters or another workspace",async()=>{
 await db.query(`INSERT INTO events(id,workspace_id,game_id,session_id,player_id,kind,name,occurred_at,received_at,country,device,source,campaign,page,properties)
  SELECT 'bulk-'||n,'w1','bulk-game','bulk-session-'||n,'bulk-player-'||n,'human','pointer',$1,$2,'NG','mobile','Direct','','','{"x":0.2,"y":0.3,"surface":"game","screen":"lobby"}'::jsonb FROM generate_series(1,51) n`,[new Date(base).toISOString(),new Date(now-1000).toISOString()]);
 const q=new URLSearchParams({kind:"heatmap",gameId:"bulk-game",days:"14",end:new Date(now).toISOString(),surface:"game",screen:"lobby",device:"mobile",bx:"4",by:"6"});
 const res=await GET(new Request(`http://localhost/api/investigation?${q}`)); const data=await res.json();
 expect(res.status).toBe(200);expect(data.results).toHaveLength(50);expect(data.hasMore).toBe(true);expect(res.headers.get("cache-control")).toBe("private, no-store");
 vi.mocked(auth.requireIdentity).mockResolvedValue({...user,workspace_id:"foreign"});
 expect((await (await GET(new Request(`http://localhost/api/investigation?${q}`))).json()).results).toEqual([]);
 q.set("bx","20");expect((await GET(new Request(`http://localhost/api/investigation?${q}`))).status).toBe(400);
 q.set("bx","4");q.set("screen","invalid/private");expect((await GET(new Request(`http://localhost/api/investigation?${q}`))).status).toBe(400);
});

it("validates pointer coordinates and screen dimensions at ingestion",async()=>{
 const game:Game={id:"ingest-game",title:"Game",url:"https://game.example",description:"",image:"",genre:"",sdkKey:"sdk_heatmap_12345678901234567890",origins:["https://game.example"],createdAt:new Date().toISOString(),dailyEnabled:false,competitors:[]};
 await db.put("w1","game",game);
 let id=0; const send=async(properties:Record<string,unknown>)=>await (await ingest(new Request("https://app.example/api/collect",{method:"POST",headers:{origin:"https://game.example"},body:JSON.stringify({sdkKey:game.sdkKey,events:[{id:`event-0000${++id}`,name:"pointer",sessionId:"session-123",playerId:"player-123",timestamp:new Date().toISOString(),properties}]})}))).json();
 expect(await send({x:.5,y:.5,surface:"game",screen:"lobby"})).toEqual({accepted:1});
 expect(await send({x:.5,y:.5})).toEqual({accepted:1});
 expect(await send({x:1.1,y:.5,surface:"game",screen:"lobby"})).toEqual({accepted:0});
 expect(await send({x:.5,y:.5,surface:"game",screen:"email@example.com"})).toEqual({accepted:0});
 expect(await send({x:.5,y:.5,surface:"game"})).toEqual({accepted:0});
 const rows=await db.query<{properties:Record<string,unknown>}>("SELECT properties FROM events WHERE workspace_id='w1' AND game_id='ingest-game' ORDER BY occurred_at,id");
 expect(rows.map(r=>r.properties)).toEqual(expect.arrayContaining([{x:.5,y:.5,surface:"game",screen:"lobby"},{x:.5,y:.5,surface:"viewport",screen:"unknown"}]));
});
