import {beforeAll,beforeEach,describe,expect,it,vi} from "vitest";
const reviewed=vi.hoisted(()=>vi.fn());vi.mock("../src/lib/content-scripts",()=>({reviewedScript:reviewed}));
let db:typeof import("../src/lib/db");let recovery:typeof import("../src/lib/content-batch-recovery");let hash:typeof import("../src/lib/security").hash;
beforeAll(async()=>{delete process.env.DATABASE_URL;delete process.env.VERCEL;process.env.LOCAL_DATABASE_PATH="memory://";db=await import("../src/lib/db");recovery=await import("../src/lib/content-batch-recovery");hash=(await import("../src/lib/security")).hash;});
beforeEach(async()=>{await db.query("DELETE FROM records");reviewed.mockReset();await db.put("ws","on_demand_content",{id:"batch",state:"needs_reconciliation",ideaIds:["idea"],scoringIdeaId:"idea",scriptRevisions:{idea:"rev"}});await db.put("ws","content_script",{id:`script_${hash("idea").slice(0,32)}`,ideaId:"idea",revision:"rev",sourceRevision:"source"});});
describe("saved batch recovery",()=>{
 it("recovers completed stored scores without another provider request",async()=>{reviewed.mockResolvedValue({script:{revision:"rev"},review:{score:{overall:80}}});expect(await recovery.reconcileContentBatch("ws","on_demand_content","batch")).toMatchObject({state:"complete",scoredIdeaIds:["idea"]});expect(await recovery.reconcileContentBatch("other","on_demand_content","batch")).toBeUndefined();});
 it("holds missing or stale results instead of repeating their model call",async()=>{reviewed.mockRejectedValue(new Error("No current score"));expect(await recovery.reconcileContentBatch("ws","on_demand_content","batch")).toMatchObject({state:"needs_reconciliation",scoringIdeaId:"idea"});});
});
