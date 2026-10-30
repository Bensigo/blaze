import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ generate: vi.fn() }));
vi.mock("ai", () => ({ generateText: mock.generate }));
const reviewMock=vi.hoisted(()=>({binding:vi.fn(),proposal:vi.fn(),approve:vi.fn(),start:vi.fn()}));
vi.mock("../src/lib/content-scripts", async (importOriginal) => ({...await importOriginal<typeof import("../src/lib/content-scripts")>(), reviewServiceBinding:reviewMock.binding, reviewScriptProposal:reviewMock.proposal, approveScriptReview:reviewMock.approve, startScriptReview:reviewMock.start}));
const reviewBinding={connectionId:"review-key",model:"review-model",settingsRevision:"r1",credentialRevision:"rc1",adapterId:"adapter",adapterRevision:"a1"};
function setupReview() {
 reviewMock.binding.mockReset().mockResolvedValue({...reviewBinding,availability:{enabled:true}});
 reviewMock.proposal.mockReset().mockImplementation(async (_workspace:string,id:string)=>{ const script=await db.get<{revision:string;reviewContextRevision:string}>("ws","content_script",id); return {binding:reviewBinding,adapterBinding:reviewBinding,reviewHash:"review-hash",script}; });
 reviewMock.approve.mockReset().mockImplementation(async (_workspace:string,_actor:string,input:{scriptId:string})=>({id:input.scriptId}));
 reviewMock.start.mockReset().mockImplementation(async (_workspace:string,id:string)=>{const script=await db.get<{revision:string;reviewContextRevision:string}>("ws","content_script",id);return {state:"complete",score:{overall:80},scriptRevision:script?.revision,reviewContextRevision:script?.reviewContextRevision};});
}

let db: typeof import("../src/lib/db"); let runner: typeof import("../src/lib/daily-content-ideas");
beforeAll(async () => {
  delete process.env.DATABASE_URL; delete process.env.VERCEL; process.env.LOCAL_DATABASE_PATH = "memory://";
  process.env.CREDENTIAL_KEY = Buffer.alloc(32, 17).toString("base64");
  db = await import("../src/lib/db"); runner = await import("../src/lib/daily-content-ideas");
});
const now = new Date("2026-10-30T05:00:00Z");
beforeEach(async () => {
  setupReview();
  await db.query("DELETE FROM records"); await db.query("DELETE FROM credentials"); await db.query("DELETE FROM jobs"); mock.generate.mockReset();
  process.env.BLAZE_DAILY_IDEAS_ENABLED = "true"; process.env.BLAZE_ON_DEMAND_CONTENT_ENABLED = "true";
  const schedule = { id: "default" as const, enabled: true, localTime: "08:00", timeZone: "Asia/Dubai" as const, countPerGame: 3 as const, maxOutputTokensPerGame: 1800 };
  await db.put("ws", "idea_schedule", schedule);
  await db.put("ws", "connection", { id: "anth", provider: "anthropic", connected: true, label: "Existing", model: "test", checkedAt: now.toISOString(), credentialVersion: "key1" });
  const { saveSecret } = await import("../src/lib/credentials"); await saveSecret("ws", "anth", { token: "test-not-real", model: "test" });
  await db.put("ws", "ai_settings", { id: "default", provider: "anthropic", connectionId: "anth", model: "test", validatedAt: now.toISOString(), revision: "ai1" });
  await db.put("ws", "daily_idea_authorization", { id: "default", expiresAt: "2026-11-01T00:00:00Z", scheduleHash: runner.ideaScheduleHash(schedule), aiSettingsRevision: "ai1", credentialVersion: "key1", approvedBy:"owner", scoreConsent:{maxCostCentsPerReview:1,maxReviewsPerDay:6,countPerGame:3,reviewerBinding:reviewBinding} });
  for (const id of ["game1", "game2"]) {
    await db.put("ws", "game", { id, title: id, url: `https://game.example/${id}`, origins: ["https://game.example"], competitors: [], createdAt: now.toISOString() });
    await db.put("ws", "game_profile", { id, gameId: id, result: "complete", facts: [{ key: "manifest_description", value: `Move the token in ${id}`, evidence: { source: "Manifest", observedAt: now.toISOString() } }], prerequisites: [] });
  }
  const {gameSources}=await import("../src/lib/content-studio-sources"); const {referenceContext}=await import("../src/lib/content-references");
  const scopes=await Promise.all(["game1","game2"].map(async id=>{const source=await gameSources("ws",id);return [id,source] as const;}));
  const old=await db.get<Record<string,unknown>>("ws","daily_idea_authorization","default");
  await db.put("ws","daily_idea_authorization",{...old,id:"default",gameIds:scopes.map(([id])=>id),sourceRevisions:Object.fromEntries(scopes.map(([id,source])=>[id,source.revision])),reviewContextRevisions:Object.fromEntries(scopes.map(([id,source])=>[id,referenceContext(source).reviewContextRevision])),generationBinding:{provider:"anthropic",model:"test",connectionId:"anth",settingsRevision:"ai1",credentialRevision:"key1"}});
  mock.generate.mockImplementation(async ({ prompt }: { prompt: string }) => {
    const { source } = JSON.parse(prompt);
    return { text: JSON.stringify({ ideas: [1, 2, 3].map(n => ({ title: `${source.gameId} angle ${n}`, hook: "Move the token", treatment: `Show actual token action ${n}`, shots: ["Start play", "Show action"], factKeys: ["manifest_description"], script: "Show the token moving using the documented controls." })) }), usage: { inputTokens: 40, outputTokens: 90 } };
  });
});
describe("daily ideas", () => {
  it("generates three per game once on the Dubai date and records token usage without inventing a cost", async () => {
    const first = await runner.runDailyIdeas("ws", now); expect(first.batches).toHaveLength(1); expect(first.batches[0].state).toBe("scoring");
    const second = await runner.runDailyIdeas("ws", now); expect(second.batches).toHaveLength(1); expect(second.batches[0].state).toBe("scoring");
    expect(await db.list("ws", "content_idea")).toHaveLength(6); expect(await db.list("ws", "content_script")).toHaveLength(6); expect(mock.generate).toHaveBeenCalledTimes(2);
    for (let i=0;i<6;i++) expect(await runner.scoreDailyIdeas("ws",now)).toMatchObject({scored:1});
    expect(reviewMock.start).toHaveBeenCalledTimes(6); expect((await db.list<{state:string}>("ws","idea_batch")).every(b=>b.state==="complete")).toBe(true);
    await runner.runDailyIdeas("ws", new Date("2026-10-30T06:00:00Z")); expect(mock.generate).toHaveBeenCalledTimes(2);
    expect(first.batches[0].usage).toMatchObject({ inputTokens: 40, outputTokens: 90, costStatus: "unavailable" });
    expect(mock.generate.mock.calls[0][0]).toMatchObject({ maxRetries: 0, maxOutputTokens: 1800 });
  });
  it("does not retry failed or interrupted paid batches and rejects invalid citations", async () => {
    mock.generate.mockResolvedValue({ text: JSON.stringify({ ideas: [1, 2, 3].map(n => ({ title: `Invented ${n}`, hook: "unknown", treatment: "unknown", shots: ["one", "two"], factKeys: ["unknown"] })) }), usage: {} });
    expect((await runner.runDailyIdeas("ws", now)).batches.every(b => b.state === "failed")).toBe(true);
    await runner.runDailyIdeas("ws", now); await runner.runDailyIdeas("ws", now); expect(mock.generate).toHaveBeenCalledTimes(2); expect(await db.list("ws", "content_idea")).toEqual([]);
  });
  it("does not reserve or spend when the approved AI connection changes", async () => {
    await db.put("ws","connection",{id:"anth",provider:"anthropic",connected:false,label:"Fixture",model:"test",credentialVersion:"key1"});
    expect((await runner.runDailyIdeas("ws",now)).batches).toEqual([]);
    expect(mock.generate).not.toHaveBeenCalled(); expect(await db.list("ws","idea_batch")).toHaveLength(0);
  });
  it("does not spend on added games or changed approved sources", async () => {
    await db.put("ws","game",{id:"game3",title:"New",url:"https://game.example/3",origins:["https://game.example"],competitors:[]});
    await db.put("ws","game_profile",{id:"game1",gameId:"game1",result:"complete",facts:[{key:"manifest_description",value:"Changed",evidence:{source:"Manifest"}}]});
    const result=await runner.runDailyIdeas("ws",now);
    expect(result.batches.map(b=>b.gameId)).toEqual(["game2"]); expect(mock.generate).toHaveBeenCalledOnce();
    await runner.runDailyIdeas("ws",now); expect(mock.generate).toHaveBeenCalledOnce();
  });
  it("holds a failed review instead of retrying and rejects old grants", async () => {
    await runner.runDailyIdeas("ws",now); reviewMock.start.mockResolvedValueOnce({state:"needs_reconciliation"});
    expect(await runner.scoreDailyIdeas("ws",now)).toMatchObject({reconciliationRequired:true});
    await runner.scoreDailyIdeas("ws",now); expect(reviewMock.start).toHaveBeenCalledOnce();
    await db.put("ws","daily_idea_authorization",{id:"default",expiresAt:"2026-11-01T00:00:00Z",scheduleHash:runner.ideaScheduleHash((await db.get("ws","idea_schedule","default"))!),aiSettingsRevision:"ai1",credentialVersion:"key1"});
    expect(await runner.runDailyIdeas("ws",now)).toMatchObject({paused:true});
  });
  it("requires fresh schedule/provider authorization and waits until the selected local time", async () => {
    expect((await runner.runDailyIdeas("ws", new Date("2026-10-30T03:00:00Z"))).batches).toEqual([]);
    await db.put("ws", "daily_idea_authorization", { id: "default", expiresAt: "2020-01-01T00:00:00Z" });
    expect(await runner.runDailyIdeas("ws", now)).toMatchObject({ paused: true }); expect(mock.generate).not.toHaveBeenCalled();
  });
});
