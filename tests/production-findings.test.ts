import { beforeAll, beforeEach, describe, expect, it } from "vitest";
let db: typeof import("../src/lib/db"), findings: typeof import("../src/lib/production-findings");
beforeAll(async () => { delete process.env.DATABASE_URL; delete process.env.VERCEL; process.env.LOCAL_DATABASE_PATH="memory://"; db=await import("../src/lib/db"); findings=await import("../src/lib/production-findings"); });
beforeEach(async () => {
  await db.query("DELETE FROM records");
  await db.put("ws","video_production",{id:"production1",gameId:"game1",state:"ready",videoUrl:"/api/media/media_abc",settings:{durationSeconds:10}});
  await db.put("ws","media",{id:"media_abc",recordingId:"production1",kind:"clip",contentType:"video/mp4"});
});
const observation={at:4,kind:"observed_error",title:"Screen froze",detail:"The image appeared to stop moving.",capturedInVideo:true};
describe("production findings",()=>{
  it("creates scoped agent-reported evidence once without overwriting owner decisions",async()=>{
    expect(await findings.persistProductionFindings("ws","production1",[observation])).toEqual({inserted:1});
    const [item]=await db.list<import("../src/lib/types").Finding>("ws","finding");
    expect(item).toMatchObject({gameId:"game1",type:"observation",priority:"medium",status:"open",detail:expect.stringContaining("not verified by a human"),evidence:[{url:"/api/media/media_abc#t=4",at:4}]});
    await db.put("ws","finding",{...item,status:"resolved",decisionNote:"Reviewed"});
    expect(await findings.persistProductionFindings("ws","production1",[observation])).toEqual({inserted:0});
    expect(await db.get("ws","finding",item.id)).toMatchObject({status:"resolved",decisionNote:"Reviewed"});
    expect(await db.list("other","finding")).toHaveLength(0);
  });
  it("filters off-video and out-of-duration reports and labels UX as a low priority hypothesis",async()=>{
    await findings.persistProductionFindings("ws","production1",[{...observation,capturedInVideo:false},{...observation,at:12},{...observation,at:11,kind:"ux_suggestion"}]);
    expect(await db.list("ws","finding")).toMatchObject([{type:"hypothesis",priority:"low"}]);
  });
  it("requires workspace-owned ready video and rejects agent URLs",async()=>{
    await expect(findings.persistProductionFindings("other","production1",[observation])).rejects.toThrow(/ready production/);
    await db.put("ws","media",{id:"media_abc",recordingId:"another",kind:"clip",contentType:"video/mp4"});
    await expect(findings.persistProductionFindings("ws","production1",[observation])).rejects.toThrow(/media/);
    expect(()=>findings.productionObservationsSchema.parse([{...observation,detail:"See https://example.com"}])).toThrow();
    expect(()=>findings.productionObservationsSchema.parse([{...observation,measurement:{metric:"fps",value:-1}}])).toThrow();
  });
});
