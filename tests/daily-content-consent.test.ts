import { beforeAll,beforeEach,describe,expect,it,vi } from "vitest";
import { randomUUID } from "node:crypto";
const mocks=vi.hoisted(()=>({ai:vi.fn(),review:vi.fn()}));
vi.mock("../src/lib/ai-settings",async original=>({...await original<typeof import("../src/lib/ai-settings")>(),resolveAISecret:mocks.ai}));
vi.mock("../src/lib/content-scripts",async original=>({...await original<typeof import("../src/lib/content-scripts")>(),reviewServiceBinding:mocks.review}));
let db:typeof import("../src/lib/db"), consent:typeof import("../src/lib/daily-content-consent");
beforeAll(async()=>{delete process.env.DATABASE_URL;delete process.env.VERCEL;process.env.LOCAL_DATABASE_PATH="memory://";db=await import("../src/lib/db");consent=await import("../src/lib/daily-content-consent");});
beforeEach(async()=>{
 await db.query("DELETE FROM records");await db.query("DELETE FROM credentials");delete process.env.BLAZE_DAILY_IDEAS_ENABLED;delete process.env.BLAZE_ON_DEMAND_CONTENT_ENABLED;
 const {hash}=await import("../src/lib/security");const {resolveScriptReviewAdapter}=await import("../src/lib/script-review-provider");const adapter=resolveScriptReviewAdapter();
 await db.put("ws","game",{id:"g",title:"Fixture",url:"https://game.example/g",origins:["https://game.example"],competitors:[]});
 await db.put("ws","game_profile",{id:"g",gameId:"g",result:"complete",prerequisites:[],facts:[{key:"manifest_controls",value:"Move the token",evidence:{source:"Manifest"}}]});
 await db.put("ws","ai_settings",{id:"default",provider:"anthropic",model:"model",connectionId:"a",revision:"a1",validatedAt:"2026-01-01"});
 await db.put("ws","connection",{id:"a",provider:"anthropic",model:"model",connected:true,credentialVersion:"ac",label:"Fixture"});
 await db.query("INSERT INTO credentials(workspace_id,provider,encrypted) VALUES($1,$2,$3)",["ws","a","fixture-a"]);
 await db.put("ws","connection",{id:"r",provider:"openrouter",connected:true,credentialVersion:"rc",label:"Fixture"});
 await db.query("INSERT INTO credentials(workspace_id,provider,encrypted) VALUES($1,$2,$3)",["ws","r","fixture-r"]);
 const credentialRevision=`rc:${hash("fixture-r")}`;
 await db.put("ws","jev_settings",{id:"default",connectionId:"r",model:"review-model",revision:"rs",credentialVersion:credentialRevision});
 mocks.ai.mockReset().mockResolvedValue({aiProvider:"anthropic",model:"model",aiConnectionId:"a",aiSettingsRevision:"a1",aiCredentialVersion:"ac"});
 mocks.review.mockReset().mockResolvedValue({connectionId:"r",model:"review-model",settingsRevision:"rs",credentialRevision,adapterId:adapter.id,adapterRevision:adapter.revision,availability:{enabled:true}});
});
describe("daily content owner consent",()=>{
 it("discloses scope and remains paused until commissioned",async()=>{
  const quote=await consent.dailyContentProposal("ws");expect(quote.availability.enabled).toBe(false);expect(quote.games).toHaveLength(1);expect(quote.costDisclosure).toContain("no verified monetary cap");
  await expect(consent.approveDailyContent("ws","owner",{proposalHash:quote.proposalHash,requestId:randomUUID(),acknowledgeCost:true})).rejects.toThrow("paused");expect(await db.get("ws","idea_schedule","default")).toBeUndefined();
 });
 it("stores exact seven-day scope and idempotent consent without extending expiry",async()=>{
  process.env.BLAZE_DAILY_IDEAS_ENABLED="true";process.env.BLAZE_ON_DEMAND_CONTENT_ENABLED="true";
  const quote=await consent.dailyContentProposal("ws"), requestId=randomUUID();
  const grant=await consent.approveDailyContent("ws","owner",{proposalHash:quote.proposalHash,requestId,acknowledgeCost:true});
  expect(grant.gameIds).toEqual(["g"]);expect(grant.scoreConsent).toMatchObject({maxCostCentsPerReview:1,maxReviewsPerDay:2,countPerGame:2});expect(Date.parse(grant.expiresAt)-Date.parse(grant.approvedAt)).toBe(7*86400000);
  expect(await db.get("ws","idea_schedule","default")).toMatchObject({enabled:true});
  expect(await consent.approveDailyContent("ws","owner",{proposalHash:quote.proposalHash,requestId,acknowledgeCost:true})).toEqual(grant);
  expect(await db.list("other","daily_idea_authorization")).toEqual([]);
 });
 it("rejects changed source or reviewer and leaves daily disabled",async()=>{
  process.env.BLAZE_DAILY_IDEAS_ENABLED="true";process.env.BLAZE_ON_DEMAND_CONTENT_ENABLED="true";
  const quote=await consent.dailyContentProposal("ws");await db.put("ws","game_profile",{id:"g",gameId:"g",result:"complete",facts:[{key:"manifest_controls",value:"Changed",evidence:{source:"Manifest"}}]});
  await expect(consent.approveDailyContent("ws","owner",{proposalHash:quote.proposalHash,requestId:randomUUID(),acknowledgeCost:true})).rejects.toThrow("changed");expect(await db.get("ws","daily_idea_authorization","default")).toBeUndefined();
 });
});
