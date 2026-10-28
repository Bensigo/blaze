import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import * as db from "../src/lib/db";
import * as auth from "../src/lib/auth";
import { queryHeatmap } from "../src/lib/heatmap";
import { GET } from "../src/app/api/analytics/heatmap/route";

const now=Date.now(), user={id:"u",email:"u@example.test",name:"Owner",workspace_id:"w1"};
let serial=0;
async function add(workspace:string,game:string,session:string,props:Record<string,unknown>,opts:{kind?:string;device?:string;time?:number;received?:number;name?:string}={}) {
 const t=opts.time ?? now-1000;
 await db.query(`INSERT INTO events(id,workspace_id,game_id,session_id,player_id,kind,name,occurred_at,received_at,country,device,source,campaign,page,properties) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'NG',$10,'','','',$11::jsonb)`,[`e${++serial}`,workspace,game,session,`p-${session}`,opts.kind ?? "human",opts.name ?? "pointer",new Date(t).toISOString(),new Date(opts.received ?? t).toISOString(),opts.device ?? "mobile",JSON.stringify(props)]);
}
const context={surface:"game" as const,screen:"lobby",device:"mobile" as const};
const scope={gameId:"g1",days:14,end:now};
beforeAll(async()=>{
 delete process.env.DATABASE_URL; delete process.env.VERCEL; process.env.LOCAL_DATABASE_PATH="memory://";
 await db.put("w1","game",{id:"g1"}); await db.put("w2","game",{id:"g2"});
 await add("w1","g1","s1",{x:.2,y:.3,...context}); await add("w1","g1","s1",{x:.21,y:.31,...context});
 await add("w1","g1","s2",{x:1,y:1,...context});
 await add("w1","g1","legacy",{x:0,y:0},{device:"other"});
 await add("w1","g1","screen",{x:.2,y:.3,surface:"game",screen:"battle"});
 await add("w1","g1","device",{x:.2,y:.3,surface:"game",screen:"lobby"},{device:"desktop"});
 await add("w1","g1","surface",{x:.2,y:.3,surface:"viewport",screen:"lobby"});
 await add("w1","g1","invalid",{x:2,y:0,...context}); await add("w1","g1","invalid2",{x:"0.2",y:.3,...context});
 await add("w1","g1","bad-context",{x:.2,y:.3,surface:"game",screen:"bad/screen"});
 await add("w1","g1","old",{x:.2,y:.3,...context},{time:now-15*86400000});
 await add("w1","g1","late",{x:.2,y:.3,...context},{received:now+1000});
 await add("w1","g1","agent",{x:.2,y:.3,...context},{kind:"agent"});
 await add("w2","g1","foreign",{x:.2,y:.3,...context}); await add("w1","g2","other",{x:.2,y:.3,...context});
});
beforeEach(()=>{vi.restoreAllMocks();vi.spyOn(auth,"requireIdentity").mockResolvedValue(user);});
afterAll(async()=>{vi.restoreAllMocks();await db.closeDatabase();});
it("selects one observed context and reports honest coverage with legacy unknowns",async()=>{
 const r=await queryHeatmap("w1",scope);
 expect(r.recentSessionsTotal).toBe(9); expect(r.recentSessions).toHaveLength(9); expect(JSON.stringify(r.recentSessions)).not.toContain("playerId");
 expect(r.selectedContext).toEqual(context); expect(r.sampleCount).toBe(3); expect(r.coordinateSessions).toBe(2);
 expect(r.eligibleSessions).toBe(9); expect(r.bins).toEqual([{bx:4,by:6,x:.225,y:.325,count:2},{bx:19,by:19,x:.975,y:.975,count:1}]);
 expect(r.contexts).toEqual(expect.arrayContaining([expect.objectContaining({surface:"viewport",screen:"unknown",device:"Unknown",sampleCount:1}),expect.objectContaining({surface:"game",screen:"battle",device:"mobile",sampleCount:1}),expect.objectContaining({surface:"game",screen:"lobby",device:"desktop",sampleCount:1})]));
 expect(r.windowStart).toBe(new Date(now-14*86400000).toISOString()); expect(r.windowEnd).toBe(new Date(now).toISOString());
});
it("honors session and explicit empty context without substituting another",async()=>{
 const r=await queryHeatmap("w1",{...scope,sessionId:"s1",context}); expect(r.sampleCount).toBe(2); expect(r.eligibleSessions).toBe(1);
 const empty=await queryHeatmap("w1",{...scope,context:{...context,screen:"missing"}}); expect(empty.selectedContext?.screen).toBe("missing");expect(empty.bins).toEqual([]);expect(empty.sampleCount).toBe(0);expect(empty.coordinateSessions).toBe(0);
 const none=await queryHeatmap("w1",{...scope,sessionId:"missing"}); expect(none.selectedContext).toBeNull();expect(none.eligibleSessions).toBe(0);
 expect((await queryHeatmap("w2",scope)).sampleCount).toBe(1);
 expect((await queryHeatmap("w1",{...scope,gameId:"g2"})).sampleCount).toBe(1);
});
it("caps grid at 400 bins",async()=>{
 await db.query(`INSERT INTO events(id,workspace_id,game_id,session_id,player_id,kind,name,occurred_at,received_at,country,device,source,campaign,page,properties) SELECT 'grid-'||x||'-'||y,'w1','grid','s','p','human','pointer',$1,$1,'','mobile','','','','{"surface":"game","screen":"grid"}'::jsonb || jsonb_build_object('x',(x+0.5)/20.0,'y',(y+0.5)/20.0) FROM generate_series(0,19) x CROSS JOIN generate_series(0,19) y`,[new Date(now-1000).toISOString()]);
 const r=await queryHeatmap("w1",{...scope,gameId:"grid"});expect(r.bins).toHaveLength(400);expect(r.sampleCount).toBe(400);
});
it("requires authentication, ownership and valid scope",async()=>{
 const req=(q:string)=>GET(new Request(`http://localhost/api/analytics/heatmap?${q}`));
 let r=await req("gameId=g1&days=14");expect(r.status).toBe(200);expect(r.headers.get("cache-control")).toBe("private, no-store");
 for(const q of ["", "gameId=g1&days=91", "gameId=g1&days=1.0", "gameId=g1&surface=game", "gameId=g1&surface=game&screen=bad%2Fscreen&device=mobile", "gameId=g1&end=invalid", "gameId=g1&sessionId="]) expect((await req(q)).status).toBe(400);
 expect((await req("gameId=g2")).status).toBe(404);
 vi.mocked(auth.requireIdentity).mockRejectedValue(new auth.HttpError(401,"Unauthorized"));expect((await req("gameId=g1")).status).toBe(401);
});
