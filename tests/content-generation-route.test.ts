import { beforeEach, describe, expect, it, vi } from "vitest";
const calls = vi.hoisted(() => ({ approve: vi.fn(), start: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireIdentity: async () => ({ workspace_id:"ws", id:"owner" }), HttpError: class extends Error {}, apiError: (e:Error) => Response.json({error:e.message},{status:409}) }));
vi.mock("@/lib/security", async original => ({...await original<typeof import("../src/lib/security")>(),sameOrigin:()=>true}));
vi.mock("@/lib/db",()=>({rateLimit:async()=>true}));
vi.mock("@/lib/content-studio",async importOriginal=>({ ...await importOriginal<typeof import("../src/lib/content-studio")>(), approveVideo:calls.approve,startApprovedVideo:calls.start }));
import { POST } from "../src/app/api/content-studio/route";
const input={action:"generate",providerRevision:"v1",ideaId:"idea",scriptRevision:"rev",scriptReviewId:"review",requestId:"c9a64698-300c-431b-8813-a5be4470f35b",settings:{aspectRatio:"9:16",durationSeconds:20,captions:"minimal",music:"quiet_generated",gameAudio:false,motionGraphics:true},maxListCostCents:100,acknowledgeCost:true};
const post=(body:unknown)=>POST(new Request("http://localhost/api/content-studio",{method:"POST",body:JSON.stringify(body)}));
describe("owner dashboard generation",()=>{
 beforeEach(()=>vi.resetAllMocks());
 it("requires consent and the exact displayed script/review before any paid start",async()=>{
  for(const body of [{...input,acknowledgeCost:false},{...input,scriptRevision:undefined},{...input,scriptReviewId:undefined}]) expect((await post(body)).status).toBe(400);
  expect(calls.approve).not.toHaveBeenCalled();expect(calls.start).not.toHaveBeenCalled();
 });
 it("starts an approved receipt once and only returns the receipt on replay",async()=>{
  calls.approve.mockResolvedValueOnce({id:"production",state:"approved"}).mockResolvedValueOnce({id:"production",state:"running"});calls.start.mockResolvedValue({id:"production",state:"running"});
  expect((await post(input)).status).toBe(200);expect((await post(input)).status).toBe(200);
  expect(calls.approve).toHaveBeenCalledWith("ws","owner",input);expect(calls.start).toHaveBeenCalledExactlyOnceWith("ws","production","owner");
 });
 it("does not retry a failed or uncertain start",async()=>{
  calls.approve.mockResolvedValue({id:"production",state:"approved"});calls.start.mockRejectedValue(new Error("Outcome uncertain"));
  expect((await post(input)).status).toBe(409);expect(calls.start).toHaveBeenCalledTimes(1);
 });
});
