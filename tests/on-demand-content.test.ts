import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
const generate = vi.hoisted(() => vi.fn());
const selection = vi.hoisted(() => vi.fn());
vi.mock("ai", () => ({ generateText: generate }));
const reviewMock=vi.hoisted(()=>({binding:vi.fn(),proposal:vi.fn(),approve:vi.fn(),start:vi.fn()}));
vi.mock("../src/lib/content-scripts", async (importOriginal) => ({...await importOriginal<typeof import("../src/lib/content-scripts")>(), reviewServiceBinding:reviewMock.binding, reviewScriptProposal:reviewMock.proposal, approveScriptReview:reviewMock.approve, startScriptReview:reviewMock.start}));
const reviewBinding={connectionId:"review-key",model:"review-model",settingsRevision:"r1",credentialRevision:"rc1",adapterId:"adapter",adapterRevision:"a1"};
function setupReview() {
 reviewMock.binding.mockReset().mockResolvedValue({...reviewBinding,availability:{enabled:true}});
 reviewMock.proposal.mockReset().mockImplementation(async (_workspace:string,id:string)=>{ const script=await db.get<{revision:string;reviewContextRevision:string}>("ws","content_script",id); return {binding:reviewBinding,adapterBinding:reviewBinding,reviewHash:"review-hash",script}; });
 reviewMock.approve.mockReset().mockImplementation(async (_workspace:string,_actor:string,input:{scriptId:string})=>({id:input.scriptId}));
 reviewMock.start.mockReset().mockImplementation(async (_workspace:string,id:string)=>{const script=await db.get<{revision:string;reviewContextRevision:string}>("ws","content_script",id);return {state:"complete",score:{overall:80},scriptRevision:script?.revision,reviewContextRevision:script?.reviewContextRevision};});
}

vi.mock("../src/lib/ai-provider", () => ({ aiModel: () => ({}) }));
vi.mock("../src/lib/ai-settings", () => ({ resolveAISecret: selection }));
let db: typeof import("../src/lib/db"); let flow: typeof import("../src/lib/on-demand-content");
const idea = (title: string) => ({ title, hook: "Move the token", treatment: "Show the documented action", shots: ["Show the token", "Show the movement"], factKeys: ["manifest_controls"], script: "Show the token moving using the documented controls." });
beforeAll(async () => { delete process.env.DATABASE_URL; delete process.env.VERCEL; process.env.LOCAL_DATABASE_PATH = "memory://"; db = await import("../src/lib/db"); flow = await import("../src/lib/on-demand-content"); });
beforeEach(async () => {
  setupReview();
  await db.query("DELETE FROM records"); await db.query("DELETE FROM jobs"); await db.query("DELETE FROM credentials");
  delete process.env.BLAZE_ON_DEMAND_CONTENT_ENABLED;
  selection.mockReset().mockResolvedValue({ token:"fixture", aiProvider:"anthropic", model:"fixture-model", aiConnectionId:"key", aiSettingsRevision:"s1", aiCredentialVersion:"c1" });
  generate.mockReset().mockResolvedValue({ text: JSON.stringify({ideas:[idea("First"),idea("Second")]}), usage:{inputTokens:100,outputTokens:200} });
  await db.put("ws", "ai_settings", {id:"default",provider:"anthropic",model:"fixture-model",connectionId:"key",revision:"s1",validatedAt:new Date().toISOString()});
  await db.put("ws", "connection", {id:"key",provider:"anthropic",connected:true,model:"fixture-model",credentialVersion:"c1",label:"Fixture"});
  await db.query("INSERT INTO credentials(workspace_id,provider,encrypted) VALUES($1,$2,$3)",["ws","key","fixture-encrypted"]);
  await db.put("ws", "game", { id:"g", title:"Fixture", url:"https://game.example/game", description:"", genre:"", image:"", sdkKey:"fixture", origins:["https://game.example"], createdAt:new Date().toISOString(), dailyEnabled:false, competitors:[] });
  await db.put("ws", "game_profile", { id:"g", gameId:"g", result:"complete", lastRefresh:new Date().toISOString(), prerequisites:[], facts:[{key:"manifest_controls",value:"Move the token",evidence:{source:"Game manifest"}}] });
});
async function approved() {
  process.env.BLAZE_ON_DEMAND_CONTENT_ENABLED="true";
  const quote = await flow.onDemandProposal("ws","g",2);
  return flow.approveOnDemand("ws","owner",{gameId:"g",count:2,proposalHash:quote.proposalHash,requestId:randomUUID()});
}
describe("on-demand content", () => {
  it("quotes byte and output bounds without a false monetary cap and remains default off", async () => {
    const quote=await flow.onDemandProposal("ws","g",2);
    expect(quote.availability.enabled).toBe(false); expect(quote.costDisclosure).toContain("no verified monetary cap");
    await expect(flow.approveOnDemand("ws","owner",{gameId:"g",count:2,proposalHash:quote.proposalHash,requestId:randomUUID()})).rejects.toThrow("paused"); expect(generate).not.toHaveBeenCalled();
  });
  it("persists a single approved request and editable scripts with current references", async () => {
    const receipt=await approved();
    const result=await flow.generateOnDemand("ws",receipt.id); expect(result.state).toBe("scoring"); expect(result.ideaIds).toHaveLength(2);
    expect((await flow.scoreOnDemand("ws",receipt.id)).state).toBe("scoring"); expect((await flow.scoreOnDemand("ws",receipt.id)).state).toBe("complete");
    const scripts=await db.list<{ideaId:string;text:string;reviewContextRevision:string}>("ws","content_script");
    expect(scripts).toHaveLength(2); expect(scripts[0].text).toContain("documented controls"); expect(scripts[0]).toMatchObject({origin:"generated"}); expect(scripts[0].reviewContextRevision).toBe(result.reviewContextRevision);
    expect(generate).toHaveBeenCalledOnce(); expect(reviewMock.start).toHaveBeenCalledTimes(2); expect(generate.mock.calls[0][0]).toMatchObject({maxRetries:0,maxOutputTokens:4000});
    await flow.generateOnDemand("ws",receipt.id); expect(generate).toHaveBeenCalledOnce();
  });
  it("binds rejection history to the quote and rejects exact repeated titles", async () => {
    await db.put("ws", "content_rejection", { id:"old", gameId:"g", title:"First", treatment:"Fixture rejected angle", rejectedAt:new Date().toISOString() });
    const receipt=await approved();
    const result=await flow.generateOnDemand("ws",receipt.id);
    expect(result.state).toBe("failed"); expect(await db.list("ws","content_idea")).toHaveLength(0);
    expect(generate.mock.calls[0][0].prompt).toContain("Fixture rejected angle");
  });
  it("keeps large history within the prompt budget and binds even omitted feedback", async () => {
    for (let i=0;i<30;i++) await db.put("ws","content_rejection",{id:`r${i}`,gameId:"g",title:`Rejected ${i}`,treatment:"🔥".repeat(1200),script:"🔥".repeat(1200),reason:"🔥".repeat(1200),rejectedAt:new Date(1700000000000+i*1000).toISOString()});
    const first=await flow.onDemandProposal("ws","g",2);
    expect(first.inputBytes).toBeLessThanOrEqual(32000);
    expect(JSON.parse(first.prompt).rejectedPatterns[0].title).toBe("Rejected 29");
    await db.put("ws","content_rejection",{id:"r0",gameId:"g",title:"Changed oldest",treatment:"🔥".repeat(1200),script:"🔥".repeat(1200),reason:"🔥".repeat(1200),rejectedAt:new Date(1700000000000).toISOString()});
    const second=await flow.onDemandProposal("ws","g",2); expect(second.proposalHash).not.toBe(first.proposalHash);
  });
  it("sends previous ideas and rejects repeated prior titles", async () => {
    await db.put("ws","content_idea",{id:"prior",gameId:"g",title:"First",treatment:"Already proposed",fingerprint:"prior",createdAt:new Date().toISOString()});
    const receipt=await approved(); const result=await flow.generateOnDemand("ws",receipt.id);
    expect(result.state).toBe("failed"); expect(generate.mock.calls[0][0].prompt).toContain("Already proposed");
    expect(await db.list("ws","content_idea")).toHaveLength(1);
  });
  it("locks and rechecks the stored provider selection before reservation", async () => {
    const receipt=await approved();
    await db.put("ws","connection",{id:"key",provider:"anthropic",connected:false,model:"fixture-model",credentialVersion:"c1",label:"Fixture"});
    await expect(flow.generateOnDemand("ws",receipt.id)).rejects.toThrow("changed before dispatch");
    expect(generate).not.toHaveBeenCalled(); expect(await db.get("ws","on_demand_content",receipt.id)).toMatchObject({state:"approved"});
  });
  it("does not spend the generated-script consent on a later owner edit", async () => {
    const receipt=await approved(); const generated=await flow.generateOnDemand("ws",receipt.id);
    const scripts=await db.list<{id:string;revision:string}>("ws","content_script");
    const {hash}=await import("../src/lib/security");
    const target=scripts.find(s=>s.id===`script_${hash(generated.ideaIds![0]).slice(0,32)}`)!;
    await db.put("ws","content_script",{...target,revision:"owner-edit"});
    expect((await flow.scoreOnDemand("ws",receipt.id)).state).toBe("needs_reconciliation"); expect(reviewMock.start).not.toHaveBeenCalled();
  });
  it("holds a failed review and never automatically repeats it", async () => {
    const receipt=await approved(); await flow.generateOnDemand("ws",receipt.id);
    reviewMock.start.mockResolvedValueOnce({state:"needs_reconciliation"});
    expect((await flow.scoreOnDemand("ws",receipt.id)).state).toBe("needs_reconciliation");
    await flow.scoreOnDemand("ws",receipt.id); expect(reviewMock.start).toHaveBeenCalledOnce();
  });
  it("holds uncertain requests and never automatically retries", async () => {
    const receipt=await approved(); generate.mockRejectedValueOnce(new Error("uncertain"));
    expect((await flow.generateOnDemand("ws",receipt.id)).state).toBe("needs_reconciliation");
    await flow.generateOnDemand("ws",receipt.id); expect(generate).toHaveBeenCalledOnce();
    await expect(approved()).rejects.toThrow("uncertain");
  });
  it("rejects stale approval before dispatch and invalid fact citations after response", async () => {
    const receipt=await approved(); selection.mockResolvedValueOnce({ token:"fixture",aiProvider:"anthropic",model:"changed",aiConnectionId:"key",aiSettingsRevision:"s2",aiCredentialVersion:"c1" });
    expect((await flow.generateOnDemand("ws",receipt.id)).state).toBe("failed"); expect(generate).not.toHaveBeenCalled();
    const next=await approved(); generate.mockResolvedValueOnce({text:JSON.stringify({ideas:[{...idea("First"),factKeys:["invented"]},idea("Second")]}),usage:{}});
    expect((await flow.generateOnDemand("ws",next.id)).state).toBe("failed"); expect(await db.list("ws","content_idea")).toHaveLength(0);
  });
});
