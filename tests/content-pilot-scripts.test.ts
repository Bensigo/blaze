import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import ffmpeg from "ffmpeg-static";
import { hash } from "../src/lib/security";
import { DEFAULT_VIDEO_SETTINGS, type VideoProduction } from "../src/lib/content-studio-contract";
import type { Game } from "../src/lib/types";
let db:typeof import("../src/lib/db"), studio:typeof import("../src/lib/content-studio"), scripts:typeof import("../src/lib/content-scripts"), creds:typeof import("../src/lib/credentials");
const game:Game={id:"dog",title:"Dog Chase",url:"https://game.example/games/dog-chase",description:"",genre:"Action",image:"",sdkKey:"unused",origins:[],createdAt:"2026-10-30T00:00:00Z",dailyEnabled:false,competitors:[]};
const scoreResult=()=>({model:"typesafe/jev-1.14-20261014",answers:{hook:{type:"score",score:3.2},pacing:{type:"score",score:2.4},clarity:{type:"score",score:3.6},shareability:{type:"score",score:2.8},unsupported_claim:{type:"noul",noul:0.2}},usage:{input_tokens:1000,output_tokens:70,cost:0.000042}});
beforeAll(async()=>{delete process.env.DATABASE_URL;delete process.env.VERCEL;process.env.LOCAL_DATABASE_PATH="memory://";process.env.CREDENTIAL_KEY=Buffer.alloc(32,19).toString("base64");db=await import("../src/lib/db");studio=await import("../src/lib/content-studio");scripts=await import("../src/lib/content-scripts");creds=await import("../src/lib/credentials");});
beforeEach(async()=>{
  vi.unstubAllGlobals();for(const name of ["BLAZE_CLOUD_PRODUCTION_ENABLED","BLAZE_CLOUD_PILOT_ENABLED","BLAZE_CLOUD_PILOT_OPERATOR_ID","BLAZE_CLOUD_PILOT_WORKSPACE_ID","BLAZE_CLOUD_PILOT_MAX_LIST_COST_CENTS","BLAZE_CLOUD_PILOT_GAME_ID","BLAZE_CLOUD_WATCHDOG_ENABLED","BLAZE_JEV_SCRIPT_REVIEW_ENABLED"])delete process.env[name];
  await db.query("DELETE FROM records");await db.query("DELETE FROM credentials");await db.query("DELETE FROM jobs");
  await db.put("ws","game",game);await db.put("ws","game_profile",{id:game.id,gameId:game.id,result:"complete",lastRefresh:"2026-10-30T00:00:00Z",facts:[{key:"manifest_description",value:"A solo runner dodges obstacles.",evidence:{source:"Game manifest",observedAt:"2026-10-30T00:00:00Z"}},{key:"manifest_controls",value:"Arrow keys jump, slide and choose a road.",evidence:{source:"Game manifest",observedAt:"2026-10-30T00:00:00Z"}}]});
});
async function setup(){
  process.env.BLAZE_CLOUD_PILOT_GAME_ID="dog";process.env.BLAZE_CLOUD_PILOT_OPERATOR_ID="owner";process.env.BLAZE_CLOUD_PILOT_WORKSPACE_ID="ws";process.env.BLAZE_CLOUD_PILOT_ENABLED="true";process.env.BLAZE_CLOUD_WATCHDOG_ENABLED="true";process.env.BLAZE_JEV_SCRIPT_REVIEW_ENABLED="true";
  await db.put("ws","connection",{id:"anth",provider:"anthropic",connected:true,label:"Saved Anthropic"});await creds.saveSecret("ws","anth",{token:"mock-anthropic",model:"mock"});
  await db.put("ws","connection",{id:"jev",provider:"openrouter",connected:true,credentialVersion:"c1"});await creds.saveSecret("ws","jev",{token:"mock-jev",model:"typesafe/jev-1.14"});
  const encrypted=(await db.query<{encrypted:string}>("SELECT encrypted FROM credentials WHERE workspace_id='ws' AND provider='jev'"))[0].encrypted;
  await db.put("ws","jev_settings",{id:"default",connectionId:"jev",model:"typesafe/jev-1.14",revision:"j1",credentialVersion:`c1:${hash(encrypted)}`});
  await db.put("ws","content_provider",{id:"default",connectionId:"anth",agentId:"agent_test",agentVersion:1,environmentId:"env_test",revision:"p1",organizationVerified:true,networkPolicyVerified:true,watchdogAdmissionVerified:true,watchdogVerified:false,pilotVerified:false});
  await db.put("ws","content_watchdog",{id:"default",configRevision:"p1",checkedAt:new Date().toISOString(),healthy:true,scanned:0,unresolved:0});
  const idea=(await studio.prepareSourceIdeas("ws",game.id))[0]; const script=await scripts.saveContentScript("ws",idea.id);
  return {idea,script};
}
async function score(){const data=await setup();const p=await scripts.reviewScriptProposal("ws",data.script.id);const r=await scripts.approveScriptReview("ws","owner",{scriptId:data.script.id,maxCostCents:1,reviewHash:p.reviewHash,requestId:randomUUID()});const fetch=vi.fn(async()=>Response.json(scoreResult()));vi.stubGlobal("fetch",fetch);const result=await scripts.startScriptReview("ws",r.id);expect(result?.state).toBe("complete");expect(fetch).toHaveBeenCalledOnce();return data;}
const inputs=(ideaId:string)=>({ideaId,settings:{...DEFAULT_VIDEO_SETTINGS,durationSeconds:10,music:"none" as const},maxListCostCents:100});
async function pilot(){const data=await score();const input=inputs(data.idea.id);const reviewed=await studio.reviewPilotVideo("ws","owner",input);const approved=await studio.approvePilotVideo("ws","owner",{...input,reviewHash:reviewed.reviewHash,requestId:randomUUID()});return {...data,input,reviewed,approved};}
describe("versioned scripts and paid Jev score admission",()=>{
  it.each(["admission","request"])("retires a known-unstarted %s deferral atomically and allows fresh granted approval",async phase=>{
    const {script}=await setup(),proposal=await scripts.reviewScriptProposal("ws",script.id);
    const review=await scripts.approveScriptReview("ws","owner",{scriptId:script.id,maxCostCents:1,reviewHash:proposal.reviewHash,requestId:randomUUID()});
    const deferred=new Error("Known window deferral"),cleanup=vi.fn(async(sql:typeof db.query)=>{await sql(`DELETE FROM records WHERE workspace_id='ws' AND kind='test_admission'`);});
    const fetch=vi.fn(async()=>Response.json(scoreResult()));vi.stubGlobal("fetch",fetch);
    await expect(scripts.startScriptReview("ws",review.id,{
      beforeDispatch:async sql=>{await sql(`INSERT INTO records(workspace_id,kind,id,body) VALUES('ws','test_admission','ledger','{"id":"ledger"}'::jsonb)`);if(phase==="admission")throw deferred;},
      beforeRequest:()=>{if(phase==="request")throw deferred;},isDispatchDeferred:error=>error===deferred,onDispatchAborted:cleanup,
    })).rejects.toBe(deferred);
    expect(fetch).not.toHaveBeenCalled();expect(cleanup).toHaveBeenCalledOnce();
    expect(await db.list("ws","test_admission")).toHaveLength(0);
    expect(await db.get("ws","script_review",review.id)).toMatchObject({state:"failed"});
    const fresh=await scripts.approveScriptReview("ws","owner",{scriptId:script.id,maxCostCents:1,reviewHash:proposal.reviewHash,requestId:randomUUID()});
    expect(await scripts.startScriptReview("ws",fresh.id)).toMatchObject({state:"complete"});expect(fetch).toHaveBeenCalledOnce();
  });

  it("drafts without inference, supports owner text and scopes records",async()=>{
    const {idea,script}=await setup();const fetch=vi.fn();vi.stubGlobal("fetch",fetch);
    expect(script.origin).toBe("source_draft");expect((await scripts.scriptState("ws",idea.id)).review).toBeUndefined();
    const edited=await scripts.saveContentScript("ws",idea.id,"One corner. Two dogs. Show a documented jump and its observed result.",script.revision);expect(edited.revision).not.toBe(script.revision);
    await expect(scripts.saveContentScript("ws",idea.id,"Different valid script text for another tab.",script.revision)).rejects.toThrow("another tab");
    await expect(scripts.saveContentScript("other",idea.id,"Owned text must stay in its own workspace.")).rejects.toThrow("Idea not found");expect((await scripts.scriptState("other",idea.id)).script).toBeUndefined();expect(fetch).not.toHaveBeenCalled();
  });
  it("reports the same paused and workspace reconciliation holds before offering a paid review",async()=>{
    await setup();const fetch=vi.fn();vi.stubGlobal("fetch",fetch);
    expect(await scripts.scriptReviewAvailability("ws")).toEqual({enabled:true});
    for(const hold of [{state:"starting"},{state:"needs_reconciliation"},{state:"complete",costAdmissionViolation:true}]){
      await db.put("ws","script_review",{id:"held-other-script",...hold});
      expect(await scripts.scriptReviewAvailability("ws")).toMatchObject({enabled:false,reason:expect.stringMatching(/earlier script review request/)});
      await db.query("DELETE FROM records WHERE workspace_id='ws' AND kind='script_review'");
    }
    await db.put("other","script_review",{id:"other-workspace-hold",state:"starting"});
    expect(await scripts.scriptReviewAvailability("ws")).toEqual({enabled:true});
    process.env.BLAZE_JEV_SCRIPT_REVIEW_ENABLED="false";
    expect(await scripts.scriptReviewAvailability("ws")).toMatchObject({enabled:false,reason:expect.stringMatching(/paused/)});
    expect(fetch).not.toHaveBeenCalled();
  });
  it("bounds the complete review input before dispatch and supports rich source facts",async()=>{
    await setup();
    const facts=Array.from({length:6},(_,i)=>({key:`manifest_about:fact${i}`,value:"A documented description. ".repeat(100).slice(0,1600),evidence:{source:"Fixture manifest",observedAt:"2026-10-30T00:00:00Z"}}));
    await db.put("ws","game_profile",{id:game.id,facts});const idea=(await studio.prepareSourceIdeas("ws",game.id))[0];const script=await scripts.saveContentScript("ws",idea.id);expect(script.text.length).toBeLessThanOrEqual(5000);
    const proposal=await scripts.reviewScriptProposal("ws",script.id);expect(proposal.inputBytes).toBeGreaterThan(12000);expect(proposal.inputBytes).toBeLessThanOrEqual(16384);
    await db.put("ws","game_profile",{id:game.id,facts:Array.from({length:30},(_,i)=>({...facts[0],key:`manifest_about:large${i}`,value:"🌍".repeat(800)}))});const largeIdea=(await studio.prepareSourceIdeas("ws",game.id))[0];const largeScript=await scripts.saveContentScript("ws",largeIdea.id);
    const fetch=vi.fn();vi.stubGlobal("fetch",fetch);await expect(scripts.reviewScriptProposal("ws",largeScript.id)).rejects.toThrow("16384-byte");expect(fetch).not.toHaveBeenCalled();
  });
  it("makes one Decisions request with rubric ratings and no generated-prose claim",async()=>{
    const {script,idea}=await score();const state=await scripts.scriptState("ws",idea.id);
    expect(state.review?.score).toMatchObject({overall:76,hook:{score:20},pacing:{score:15},clarity:{score:23},shareability:{score:18}});
    expect(state.review?.score?.hook.explanation).toContain("Rubric:");expect(state.review?.scriptText).toBe(script.text);expect(state.caveat).toContain("not a predicted");
    const [url,init]=vi.mocked(fetch).mock.calls[0];expect(url).toBe("https://openrouter.ai/api/alpha/decisions");const request=JSON.parse(String(init?.body));expect(request.provider.allow_fallbacks).toBe(false);expect(request.provider.only).toEqual(["typesafe"]);expect(Buffer.byteLength(String(init?.body),"utf8")).toBeLessThanOrEqual(16384);expect(new Headers(init?.headers).has("TypeSafe-Danger-Zone-Long-Context")).toBe(false);expect(Object.keys(request.questions)).toHaveLength(5);expect(request).not.toHaveProperty("messages");
    await scripts.startScriptReview("ws",state.review!.id);expect(fetch).toHaveBeenCalledOnce();
  });
  it("requires fresh explicit review approval, rejects changed/expired selection and never retries ambiguity",async()=>{
    const {script}=await setup();const p=await scripts.reviewScriptProposal("ws",script.id);delete process.env.BLAZE_JEV_SCRIPT_REVIEW_ENABLED;
    await expect(scripts.approveScriptReview("ws","owner",{scriptId:script.id,maxCostCents:1,reviewHash:p.reviewHash,requestId:randomUUID()})).rejects.toThrow("paused");process.env.BLAZE_JEV_SCRIPT_REVIEW_ENABLED="true";
    const r=await scripts.approveScriptReview("ws","owner",{scriptId:script.id,maxCostCents:1,reviewHash:p.reviewHash,requestId:randomUUID()});const fetch=vi.fn(async()=>{throw Error("Response lost");});vi.stubGlobal("fetch",fetch);
    const timeout = vi.spyOn(AbortSignal, "timeout");
    await Promise.all([scripts.startScriptReview("ws",r.id,{timeoutMs:15000}),scripts.startScriptReview("ws",r.id,{timeoutMs:15000})]);expect(timeout).toHaveBeenCalledWith(15000);timeout.mockRestore();expect(fetch).toHaveBeenCalledOnce();expect((await db.get<{id:string;state:string}>("ws","script_review",r.id))?.state).toBe("needs_reconciliation");await scripts.startScriptReview("ws",r.id);expect(fetch).toHaveBeenCalledOnce();
    await expect(scripts.approveScriptReview("ws","owner",{scriptId:script.id,maxCostCents:1,reviewHash:p.reviewHash,requestId:randomUUID()})).rejects.toThrow("uncertain");
  });
  it("reserves exactly one cent locally and fails closed on a provider admission violation",async()=>{
    const {script,idea}=await setup();const p=await scripts.reviewScriptProposal("ws",script.id);
    expect(p.costAdmission.maxCostBoundUsd).toBe(0.002752512);
    await expect(scripts.approveScriptReview("ws","owner",{scriptId:script.id,maxCostCents:2 as 1,reviewHash:p.reviewHash,requestId:randomUUID()})).rejects.toThrow();
    expect(await db.list("ws","script_review")).toHaveLength(0);
    const grant=await scripts.approveScriptReview("ws","owner",{scriptId:script.id,maxCostCents:1,reviewHash:p.reviewHash,requestId:randomUUID()});
    expect(grant).toMatchObject({maxCostCents:1,maxCostBoundNanoUsd:2752512,maxBillableInputTokens:65536});
    const raw=scoreResult();raw.usage.cost=0.02;const fetch=vi.fn(async()=>Response.json(raw));vi.stubGlobal("fetch",fetch);
    expect(await scripts.startScriptReview("ws",grant.id)).toMatchObject({state:"needs_reconciliation",costAdmissionViolation:true,usage:{reportedCostUsd:0.02}});
    expect((await scripts.scriptState("ws",idea.id)).review?.score).toBeUndefined();
    await expect(scripts.approveScriptReview("ws","owner",{scriptId:script.id,maxCostCents:1,reviewHash:p.reviewHash,requestId:randomUUID()})).rejects.toThrow("Reconcile billing");expect(fetch).toHaveBeenCalledOnce();
  });
  it.each([
    {input_tokens:1000,cost:0.02},
    {input_tokens:65537,output_tokens:"invalid",cost:0.0001},
    {input_tokens:1000,output_tokens:70,cost:"invalid"},
    undefined,
  ])("holds workspace admission when any billing field is missing/malformed or exceeds bounds",async usage=>{
    const {script}=await setup();const p=await scripts.reviewScriptProposal("ws",script.id);const r=await scripts.approveScriptReview("ws","owner",{scriptId:script.id,maxCostCents:1,reviewHash:p.reviewHash,requestId:randomUUID()});
    const fetch=vi.fn(async()=>Response.json({...scoreResult(),usage}));vi.stubGlobal("fetch",fetch);
    const result=await scripts.startScriptReview("ws",r.id);expect(result).toMatchObject({state:"needs_reconciliation",costAdmissionViolation:true});expect(result?.score).toBeUndefined();
    if(usage?.cost===0.02)expect(result?.usage?.reportedCostUsd).toBe(0.02);
    expect(await scripts.startScriptReview("ws",r.id)).toMatchObject({state:"needs_reconciliation"});await expect(scripts.approveScriptReview("ws","owner",{scriptId:script.id,maxCostCents:1,reviewHash:p.reviewHash,requestId:randomUUID()})).rejects.toThrow("Reconcile billing");expect(fetch).toHaveBeenCalledOnce();
  });
  it.each(["not-json", "timeout", "oversized", "non-success"])("holds unverifiable post-dispatch billing (%s) without retry",async failure=>{
    const {script}=await setup();const p=await scripts.reviewScriptProposal("ws",script.id);const r=await scripts.approveScriptReview("ws","owner",{scriptId:script.id,maxCostCents:1,reviewHash:p.reviewHash,requestId:randomUUID()});
    const fetch=vi.fn(async()=>{if(failure==="timeout")throw Error("Connection lost");if(failure==="oversized")return new Response("x".repeat(128*1024+1));if(failure==="non-success")return new Response(null,{status:503});return new Response("not-json",{status:200});});vi.stubGlobal("fetch",fetch);
    expect(await scripts.startScriptReview("ws",r.id)).toMatchObject({state:"needs_reconciliation",costAdmissionViolation:true});
    expect(await scripts.startScriptReview("ws",r.id)).toMatchObject({state:"needs_reconciliation"});expect(fetch).toHaveBeenCalledOnce();
    await expect(scripts.approveScriptReview("ws","owner",{scriptId:script.id,maxCostCents:1,reviewHash:p.reviewHash,requestId:randomUUID()})).rejects.toThrow("Reconcile billing");
  });
  it("serializes different approved scripts before any second paid dispatch",async()=>{
    const {script}=await setup();const secondIdea=(await studio.prepareSourceIdeas("ws",game.id))[1];const secondScript=await scripts.saveContentScript("ws",secondIdea.id);
    const grants=[];for(const current of [script,secondScript]){const p=await scripts.reviewScriptProposal("ws",current.id);grants.push(await scripts.approveScriptReview("ws","owner",{scriptId:current.id,maxCostCents:1,reviewHash:p.reviewHash,requestId:randomUUID()}));}
    let release!:()=>void, entered!:()=>void, twice!:()=>void;const gate=new Promise<void>(r=>release=r),firstCall=new Promise<void>(r=>entered=r),secondCall=new Promise<void>(r=>twice=r);
    let calls=0;const fetch=vi.fn(async()=>{if(++calls===1)entered();else twice();await gate;return Response.json(scoreResult());});vi.stubGlobal("fetch",fetch);
    const pending=grants.map(g=>scripts.startScriptReview("ws",g.id).then(()=>"settled",()=>"settled"));
    await firstCall;const observed=await Promise.race([secondCall.then(()=>"duplicate"),...pending]);release();await Promise.all(pending);expect(observed).toBe("settled");expect(fetch).toHaveBeenCalledOnce();
  });
  it("consumes stale unused review approvals and allows a newly edited version to be scored",async()=>{
    const {script,idea}=await setup();const proposal=await scripts.reviewScriptProposal("ws",script.id);const prior=await scripts.approveScriptReview("ws","owner",{scriptId:script.id,maxCostCents:1,reviewHash:proposal.reviewHash,requestId:randomUUID()});
    await scripts.saveContentScript("ws",idea.id,"A new opening and a clear source-grounded obstacle sequence.",script.revision);
    expect(await db.get("ws","script_review",prior.id)).toMatchObject({state:"failed"});const next=await scripts.reviewScriptProposal("ws",script.id);const grant=await scripts.approveScriptReview("ws","owner",{scriptId:script.id,maxCostCents:1,reviewHash:next.reviewHash,requestId:randomUUID()});
    await db.put("ws","script_review",{...grant,expiresAt:"2020-01-01T00:00:00Z"});const fetch=vi.fn();vi.stubGlobal("fetch",fetch);expect(await scripts.startScriptReview("ws",grant.id)).toMatchObject({state:"failed"});expect(fetch).not.toHaveBeenCalled();
    expect(await scripts.approveScriptReview("ws","owner",{scriptId:script.id,maxCostCents:1,reviewHash:next.reviewHash,requestId:randomUUID()})).toMatchObject({state:"approved"});
  });
  it("uses the latest attempt consistently when a repeated review fails",async()=>{
    const {script,idea}=await score();const p=await scripts.reviewScriptProposal("ws",script.id);const grant=await scripts.approveScriptReview("ws","owner",{scriptId:script.id,maxCostCents:1,reviewHash:p.reviewHash,requestId:randomUUID()});
    vi.stubGlobal("fetch",vi.fn(async()=>Response.json({...scoreResult(),answers:{}})));expect(await scripts.startScriptReview("ws",grant.id)).toMatchObject({state:"failed"});expect((await scripts.scriptState("ws",idea.id)).review?.state).toBe("failed");await expect(scripts.reviewedScript("ws",idea.id,script.sourceRevision)).rejects.toThrow("successful script review score");
  });
  it("rejects malformed/out-of-range scores without fake defaults or a retry",async()=>{
    for(const value of [-1,4.1,101,NaN]){const raw=scoreResult();raw.answers.hook.score=value;expect(()=>scripts.scoreFromDecisions(raw,"typesafe/jev-1.14")).toThrow();}
    expect(()=>scripts.scoreFromDecisions({...scoreResult(),model:"other/model"},"typesafe/jev-1.14")).toThrow();
    const {script,idea}=await setup();const p=await scripts.reviewScriptProposal("ws",script.id);const r=await scripts.approveScriptReview("ws","owner",{scriptId:script.id,maxCostCents:1,reviewHash:p.reviewHash,requestId:randomUUID()});const raw=scoreResult();raw.answers.clarity.score=99;
    const fetch=vi.fn(async()=>Response.json(raw));vi.stubGlobal("fetch",fetch);expect(await scripts.startScriptReview("ws",r.id)).toMatchObject({state:"failed"});expect((await scripts.scriptState("ws",idea.id)).review?.score).toBeUndefined();await scripts.startScriptReview("ws",r.id);expect(fetch).toHaveBeenCalledOnce();
  });
});
describe("single-use operator cloud pilot",()=>{
  it("waives only unproven pilot evidence while retaining operator, network, account, monitor and score gates",async()=>{
    const {idea}=await setup();const input=inputs(idea.id);await expect(studio.reviewPilotVideo("ws","owner",input)).rejects.toThrow("successful script review score");
    await score();await expect(studio.reviewPilotVideo("ws","other",input)).rejects.toThrow("operator");await expect(studio.reviewPilotVideo("other","owner",input)).rejects.toThrow("operator");
    expect((await studio.reviewPilotVideo("ws","owner",input)).ready).toBe(true);expect((await studio.studioReadiness("ws")).ready).toBe(false);
    const config=(await db.get<any>("ws","content_provider","default"))!;
    for(const key of ["organizationVerified","networkPolicyVerified","watchdogAdmissionVerified"]){await db.put("ws","content_provider",{...config,[key]:false});expect((await studio.reviewPilotVideo("ws","owner",input)).ready).toBe(false);}await db.put("ws","content_provider",config);
    await db.put("ws","content_watchdog",{id:"default",configRevision:"p1",checkedAt:"2020-01-01T00:00:00Z",healthy:true});expect((await studio.reviewPilotVideo("ws","owner",input)).ready).toBe(false);
  });
  it("binds exact settings/revisions, preserves repeated grant identity, and does not set normal verification flags",async()=>{
    const {idea}=await score();const input=inputs(idea.id),review=await studio.reviewPilotVideo("ws","owner",input),requestId=randomUUID();
    await expect(studio.approvePilotVideo("ws","owner",{...input,settings:{...input.settings,durationSeconds:20},reviewHash:review.reviewHash,requestId})).rejects.toThrow("review changed");
    const a=await studio.approvePilotVideo("ws","owner",{...input,reviewHash:review.reviewHash,requestId});const b=await studio.approvePilotVideo("ws","owner",{...input,reviewHash:review.reviewHash,requestId});expect(a.id).toBe(b.id);expect(await db.list("ws","pilot_grant")).toHaveLength(1);
    await expect(studio.approvePilotVideo("ws","owner",{...input,reviewHash:review.reviewHash,requestId:randomUUID()})).rejects.toThrow("pilot already");
    expect(await db.get("ws","content_provider","default")).toMatchObject({pilotVerified:false,watchdogVerified:false});
  });
  it("consumes one grant before a single uncertain create and blocks fresh starts without retry",async()=>{
    const {approved,input}=await pilot();const fetch=vi.fn(async()=>{throw Error("Create result lost");});vi.stubGlobal("fetch",fetch);
    await Promise.all([studio.startApprovedVideo("ws",approved.id,"owner"),studio.startApprovedVideo("ws",approved.id,"owner")]);expect(fetch).toHaveBeenCalledOnce();
    expect(await db.get("ws","pilot_grant",approved.pilotGrantId!)).toMatchObject({state:"consumed"});expect(await db.get("ws","video_production",approved.id)).toMatchObject({state:"needs_reconciliation"});
    await studio.startApprovedVideo("ws",approved.id,"owner");expect(fetch).toHaveBeenCalledOnce();expect((await studio.reviewPilotVideo("ws","owner",input)).ready).toBe(false);
  });
  it("blocks stale script/critique, changed provider/keys, expired grants, and wrong actors before provider dispatch",async()=>{
    const {approved,script,idea}=await pilot();const fetch=vi.fn();vi.stubGlobal("fetch",fetch);
    await expect(studio.startApprovedVideo("ws",approved.id)).rejects.toThrow("operator");
    process.env.BLAZE_CLOUD_PILOT_GAME_ID="different-game";await expect(studio.startApprovedVideo("ws",approved.id,"owner")).rejects.toThrow("pilot target changed");process.env.BLAZE_CLOUD_PILOT_GAME_ID="dog";
    await creds.saveSecret("ws","anth",{token:"rotated-test",model:"mock"});await expect(studio.startApprovedVideo("ws",approved.id,"owner")).rejects.toThrow("key changed");
    await scripts.saveContentScript("ws",idea.id,"A revised hook with a new sequence of documented actions.",script.revision);expect((await scripts.scriptState("ws",idea.id)).review).toBeUndefined();expect((await scripts.scriptState("ws",idea.id)).staleReview?.score).toBeDefined();
    expect(await db.get("ws","video_production",approved.id)).toMatchObject({state:"failed"});expect(fetch).not.toHaveBeenCalled();
  });
  it("rejects expired grants and retains cancellation racing creation",async()=>{
    const {approved}=await pilot();const grant=(await db.get<any>("ws","pilot_grant",approved.pilotGrantId!))!;const fetch=vi.fn();vi.stubGlobal("fetch",fetch);
    await db.put("ws","pilot_grant",{...grant,expiresAt:"2020-01-01T00:00:00Z"});await expect(studio.startApprovedVideo("ws",approved.id,"owner")).rejects.toThrow("Pilot grant");expect(fetch).not.toHaveBeenCalled();
    await db.put("ws","pilot_grant",grant);vi.stubGlobal("fetch",vi.fn(async(url:RequestInfo|URL)=>{if(String(url).endsWith("/sessions")){await studio.cancelVideo("ws",approved.id);return Response.json({id:"sesn_cancel",status:"running"});}return Response.json({data:[]});}));
    expect(await studio.startApprovedVideo("ws",approved.id,"owner")).toMatchObject({state:"cancel_requested",sessionId:"sesn_cancel"});expect(globalThis.fetch).toHaveBeenCalledTimes(2);expect(await db.get("ws","pilot_grant",approved.pilotGrantId!)).toMatchObject({state:"consumed"});
  });
  it("tracks pilot runtime independently without falsely verifying normal production",async()=>{
    const {approved}=await pilot();await db.put("ws","video_production",{...approved,state:"running",sessionId:"sesn_pilot",startedAt:"2020-01-01T00:00:00Z",watchdogDeadlineAt:"2020-01-01T00:30:00Z"});
    const fetch=vi.fn(async(_url:RequestInfo|URL,init?:RequestInit)=>Response.json(init?.method==="POST"?{data:[]}:{id:"sesn_pilot",status:"running"}));vi.stubGlobal("fetch",fetch);
    const watchdog=await import("../src/lib/content-production-watchdog");await watchdog.tickProductionWatchdog("ws");expect(fetch).toHaveBeenCalledTimes(2);expect(await db.get("ws","video_production",approved.id)).toMatchObject({state:"cancel_requested"});
    await watchdog.tickProductionWatchdog("ws");expect(fetch).toHaveBeenCalledTimes(3);expect(vi.mocked(fetch).mock.calls.filter(([,i])=>i?.method==="POST")).toHaveLength(1);
  });
  it("imports one scoped pilot video, shows it in the workspace snapshot and plans manual posting",async()=>{
    const {approved}=await pilot();const fetchStart=vi.fn(async(_url:RequestInfo|URL,_init?:RequestInit)=>Response.json({id:"sesn_pilot",status:"running"}));vi.stubGlobal("fetch",fetchStart);await studio.startApprovedVideo("ws",approved.id,"owner");expect(fetchStart).toHaveBeenCalledOnce();
    const payload=JSON.parse(String(fetchStart.mock.calls[0]?.[1]?.body));expect(JSON.parse(payload.initial_events[0].content[0].text).script.text).toBe(approved.scriptText);
    const encoded=spawnSync(ffmpeg!,["-v","error","-f","lavfi","-i","color=green:s=360x640:r=15:d=10","-c:v","libx264","-preset","ultrafast","-pix_fmt","yuv420p","-movflags","frag_keyframe+empty_moov","-f","mp4","pipe:1"],{maxBuffer:4*1024*1024});if(encoded.status!==0)throw Error(encoded.stderr.toString());
    const report=Buffer.from(JSON.stringify({gameUrl:game.url,durationSeconds:10,playedActions:[{at:1,action:"Mocked parser input, not real cloud gameplay"}],rawCaptureFilename:"raw.webm",audioCaptured:false,limitations:["Synthetic test only"]}));
    vi.stubGlobal("fetch",vi.fn(async(url:RequestInfo|URL,init?:RequestInit)=>{expect(init?.method||"GET").toBe("GET");if(String(url).includes("/sessions/"))return Response.json({id:"sesn_pilot",status:"idle"});if(String(url).includes("/files?scope_id=sesn_pilot"))return Response.json({data:[{id:"file_video",filename:"video.mp4",size_bytes:encoded.stdout.length},{id:"file_evidence",filename:"evidence.json",size_bytes:report.length},{id:"file_raw",filename:"raw.webm",size_bytes:2000}]});if(String(url).endsWith("/file_evidence/content"))return new Response(report);if(String(url).endsWith("/file_video/content"))return new Response(encoded.stdout);throw Error("Unexpected request");}));
    const ready=await studio.refreshVideo("ws",approved.id);try{expect(ready.state).toBe("ready");expect((await studio.studioSnapshot("ws")).productions[0].videoUrl).toBe(ready.videoUrl);expect((await studio.studioSnapshot("other")).productions).toEqual([]);expect(await studio.planVideo("ws",approved.id,"2026-11-02")).toMatchObject({plannedDate:"2026-11-02",planningTimeZone:"Asia/Dubai"});await expect(studio.planVideo("other",approved.id,"2026-11-02")).rejects.toThrow("Video not found");expect(await db.list("ws","post")).toEqual([]);}finally{if(ready.videoUrl)await(await import("../src/lib/media")).deleteAsset("ws",ready.videoUrl);}
  });
});
