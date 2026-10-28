// Explicit release acceptance. Default mode performs anonymous read-only checks.
// Real owner Google sign-in, and optional isolated fixture writes, require separate opt-ins.
import { chromium, type BrowserContext } from "playwright";
import { randomUUID } from "node:crypto";
import { mkdir, open, unlink } from "node:fs/promises";
import { resolve } from "node:path";
import assert from "node:assert/strict";
import { privateStatePath, releaseOrigin } from "./release-acceptance-utils";

const base = releaseOrigin(process.env.RELEASE_BASE_URL);
const mode = process.env.RELEASE_ACCEPTANCE_MODE || "public";
if (!["public", "google", "fixture"].includes(mode)) throw new Error("Use RELEASE_ACCEPTANCE_MODE=public, google, or fixture.");
if (mode !== "public" && process.env.ALLOW_LIVE_ACCEPTANCE !== "true") throw new Error("Authenticated acceptance requires ALLOW_LIVE_ACCEPTANCE=true.");
if (mode === "fixture" && process.env.ALLOW_LIVE_FIXTURE_WRITES !== "true") throw new Error("Fixture acceptance requires ALLOW_LIVE_FIXTURE_WRITES=true.");
class PublicCheckError extends Error {}
function checkStatus(actual: number, expected: number, label: string) {
  if (actual !== expected) throw new PublicCheckError(`${label}: expected ${expected}, received ${actual}.`);
}

async function publicChecks() {
  const health = await fetch(`${base}/api/health`, { cache:"no-store" });
  checkStatus(health.status, 200, "Release health");
  const workspace = await fetch(`${base}/api/workspace`, { cache:"no-store" });
  checkStatus(workspace.status, 401, "Anonymous workspace access");
  const dev = await fetch(`${base}/api/auth/dev`, {method:"POST",headers:{Origin:base},cache:"no-store"});
  checkStatus(dev.status, 404, "Production dev sign-in");
  const settings = await fetch(`${base}/api/auth/config`, {cache:"no-store"});
  checkStatus(settings.status, 200, "Public auth configuration");
  return { health: "ok", anonymousWorkspace: 401, productionDevLogin: 404, googleConfigured: (await settings.json()).googleConfigured === true };
}

async function authenticatedSnapshot(context: BrowserContext) {
  const response = await context.request.get(`${base}/api/workspace`, { failOnStatusCode:false });
  if (response.status() !== 200) throw new Error("The selected browser session is not authenticated to this release.");
  const data = await response.json();
  if (!data?.workspace?.id || !data?.user) throw new Error("Authenticated workspace response is incomplete.");
  return data;
}

async function privateState(context: BrowserContext, workDirectory: string, label: string) {
  // A unique file and exclusive create prevent overwriting existing credentials.
  const path = resolve(workDirectory, `neon-google-${label}-${randomUUID()}.json`);
  const handle = await open(path, "wx", 0o600);
  try { await handle.writeFile(JSON.stringify(await context.storageState())); await handle.chmod(0o600); }
  finally { await handle.close(); }
  return path;
}

async function liveChecks() {
  const result = await publicChecks();
  if (!result.googleConfigured) throw new Error("Owner-configured Neon Google authentication is not enabled; live sign-in was not attempted.");
  const workDirectory = resolve("work"); await mkdir(workDirectory, {recursive:true,mode:0o700});
  const existingOwner = process.env.ACCEPTANCE_OWNER_STATE ? await privateStatePath(process.env.ACCEPTANCE_OWNER_STATE, workDirectory) : undefined;
  const foreignPath = process.env.ACCEPTANCE_FOREIGN_STATE ? await privateStatePath(process.env.ACCEPTANCE_FOREIGN_STATE, workDirectory) : undefined;
  // A real owner signs in through Google; this helper never fabricates users, cookies or login links.
  const browser = await chromium.launch({headless:!!existingOwner, args:["--disk-cache-size=1","--media-cache-size=1"]});
  const owner = await browser.newContext(existingOwner ? {storageState:existingOwner} : {});
  let foreign: BrowserContext | undefined;
  try {
    if (!existingOwner) {
      const page=await owner.newPage();
      console.log("Complete the real Google sign-in in the opened browser. No credentials are collected by this helper.");
      await page.goto(`${base}/api/auth/google`, {waitUntil:"domcontentloaded"});
      await page.waitForURL(url => url.origin===base && url.pathname==="/app", {timeout:300000});
      if (new URL(page.url()).searchParams.has("auth")) throw new Error("Google sign-in did not complete successfully.");
    }
    const snapshot=await authenticatedSnapshot(owner);
    const statePath=existingOwner || await privateState(owner,workDirectory,"owner");
    const report: Record<string,unknown> = { public:result, authentication:existingOwner ? "existing real Neon session verified; a fresh Google round trip was not tested" : "real Google sign-in returned to the app and verified a Neon workspace", privateState:statePath, foreignWorkspace:"unverified: no authorized second user state supplied", fixtureCapture:"not run", foreverOrJev:"not tested" };
    if (foreignPath) {
      foreign=await browser.newContext({storageState:foreignPath});
      const second=await authenticatedSnapshot(foreign);
      assert.notEqual(second.workspace.id,snapshot.workspace.id,"Second session must belong to a different verified workspace.");
      const game=snapshot.games?.[0];
      if (game?.id) {
        const path=`${base}/api/games/${encodeURIComponent(game.id)}/profile`;
        assert.equal((await owner.request.get(path)).status(),200,"Owner game access failed.");
        assert.equal((await foreign.request.get(path)).status(),404,"Foreign workspace must not read owner game.");
        report.foreignWorkspace="two real authenticated workspaces; owner game profile 200, foreign 404";
      } else report.foreignWorkspace="two real authenticated workspaces are distinct; cross-workspace resource access unverified because owner has no game";
    }
    if (mode === "fixture") report.fixtureCapture = await fixtureCapture(browser,owner,foreign,snapshot.workspace.id,workDirectory);
    console.log(JSON.stringify(report));
  } finally { await foreign?.close(); await owner.close(); await browser.close(); }
}

async function fixtureCapture(browser: Awaited<ReturnType<typeof chromium.launch>>, owner: BrowserContext, foreign: BrowserContext | undefined, workspace: string, workDirectory: string) {
  try { process.loadEnvFile(".env.vercel.local"); process.loadEnvFile(".env.release.local"); }
  catch { throw new Error("Fixture mode requires the release environment files; no values were logged."); }
  if (!process.env.DATABASE_URL || !process.env.BLOB_READ_WRITE_TOKEN) throw new Error("Fixture mode requires the private release database and private Blob credentials.");
  const db=await import("../src/lib/db");
  const {inspectCaptureVideo}=await import("../src/lib/capture-video");
  const {del}=await import("@vercel/blob");
  const knownOwner=(await db.query<{id:string}>("SELECT id FROM users WHERE workspace_id=$1",[workspace]))[0];
  if (!knownOwner?.id?.startsWith("neon:")) throw new Error("The private database does not contain the verified owner workspace; fixture writes were not attempted.");
  const priorIntents = new Set((await db.query<{id:string}>("SELECT id FROM records WHERE workspace_id=$1 AND kind='media_storage_intent'",[workspace])).map(row=>row.id));
  const gameId=db.id("game"), sdkKey=db.id("sdk"), recovery=resolve(workDirectory,`capture-fixture-${randomUUID()}.json`);
  const entry=await open(recovery,"wx",0o600);
  try { await entry.writeFile(JSON.stringify({workspace,gameId,origin:base,kind:"isolated capture fixture"})); await entry.chmod(0o600); } finally {await entry.close();}
  const game={id:gameId,title:`Capture acceptance ${gameId}`,url:`${base}/fixture/index.html`,description:"Controlled isolated release fixture.",image:`${base}/fixture/cover.svg`,genre:"Fixture",sdkKey,origins:[base],createdAt:new Date().toISOString(),dailyEnabled:false,competitors:[],capture:{enabled:true,canvasSelector:"#game",surfaceReviewed:true,sampleRate:1,maxDurationSeconds:5,maxSegments:1,retentionDays:1,maxCapturesPerDay:2,masks:[{x:0,y:0,width:.25,height:.25}]}};
  let attempted=false, result: Record<string,unknown> | undefined;
  try {
    attempted=true;
    await db.query(`INSERT INTO records(workspace_id,kind,id,body) VALUES($1,'game',$2,$3::jsonb)`,[workspace,gameId,JSON.stringify(game)]);
    const deployedFixture=await owner.request.get(`${base}/api/games/${encodeURIComponent(gameId)}/profile`);
    if (deployedFixture.status()!==200) throw new Error("The deployed application did not observe the isolated fixture in this database.");
    const fixtureContext=await browser.newContext();
    const page=await fixtureContext.newPage();
    try {
      await page.goto(`${base}/fixture/index.html`,{waitUntil:"domcontentloaded"});
      assert.equal((await page.evaluate(()=>(window as any).Blaze.startCapture({consent:true}))).status,"consent_required");
      await page.evaluate(key=>(window as any).Blaze.init({endpoint:location.origin,sdkKey:key,consent:true}),sdkKey);
      assert.equal((await page.evaluate(()=>(window as any).Blaze.startCapture({consent:false}))).status,"consent_required");
      const started=await page.evaluate(()=>(window as any).Blaze.startCapture({consent:true}));
      assert.equal(started.status,"recording","Controlled fixture recording did not start.");
      await page.waitForTimeout(1200);
      const ready=await page.evaluate(()=>(window as any).Blaze.stopCapture());assert.equal(ready.status,"ready","Controlled fixture recording failed.");
      const session=await page.evaluate(key=>sessionStorage.getItem(`gm_session_${key}_id`),sdkKey);assert.ok(session);
      const details=await owner.request.get(`${base}/api/sessions/${encodeURIComponent(session)}?gameId=${encodeURIComponent(gameId)}`);assert.equal(details.status(),200);
      const capture=(await details.json()).capture;assert.equal(capture?.status,"ready");
      const assetId=/^\/api\/media\/(media_[a-z0-9]+)$/.exec(capture.videoUrl || "")?.[1];assert.ok(assetId);
      const asset=await db.get<{id:string;captureId:string;backend:string}>(workspace,"media",assetId);assert.equal(asset?.backend,"blob");assert.equal(asset?.captureId,capture.id);
      const anon=await browser.newContext();try {assert.equal((await anon.request.get(`${base}${capture.videoUrl}`)).status(),401);} finally {await anon.close();}
      if(foreign) assert.equal((await foreign.request.get(`${base}${capture.videoUrl}`)).status(),404);
      assert.equal((await owner.request.get(`${base}${capture.videoUrl}`,{headers:{Range:"bytes=0-31"}})).status(),206);
      const video=await owner.request.get(`${base}${capture.videoUrl}`);assert.equal(video.status(),200);const bytes=await video.body();
      const info=await inspectCaptureVideo(bytes,5);assert.ok(info.fps<=5.5 && bytes.length<=3145728);
      result={surface:"controlled fixture only", consent:"separate recording consent required", privateBlob:"verified", ownerPlayback:"200 and range 206", anonymous:"401", foreign:foreign?"404":"unverified: no second authorized user", media:"server-inspected silent video", realForeverOrJev:"not tested"};
    } finally {await fixtureContext.close();}
  } finally {
    if(attempted) {
      try {
        const current=await db.get<{id:string;sdkKey:string;title:string}>(workspace,"game",gameId);
        if(current && (current.sdkKey!==sdkKey || current.title!==game.title)) throw new Error("Fixture ownership is not confirmed.");
        if (!current) {
          const related=await db.query(`SELECT id FROM events WHERE workspace_id=$1 AND game_id=$2 LIMIT 1`,[workspace,gameId]);
          const grants=await db.query(`SELECT capture_id FROM session_capture_grants WHERE workspace_id=$1 AND game_id=$2 LIMIT 1`,[workspace,gameId]);
          if (related.length || grants.length) throw new Error("Fixture identity is missing; associated records require review.");
        }
        const newIntents=(await db.query<{id:string}>("SELECT id FROM records WHERE workspace_id=$1 AND kind='media_storage_intent'",[workspace])).filter(row=>!priorIntents.has(row.id));
        if(newIntents.length) throw new Error("Unresolved upload intents require separate review.");
        const assets=await db.query<{id:string;body:{id:string;location:string;backend:string;recordingId:string;captureId:string;kind:string}}>(`SELECT id,body FROM records WHERE workspace_id=$1 AND kind='media' AND body->>'captureId' IN (SELECT capture_id FROM session_capture_grants WHERE workspace_id=$1 AND game_id=$2)`,[workspace,gameId]);
        for(const asset of assets) { if(asset.body.backend!=="blob" || asset.body.id!==asset.id || asset.body.recordingId!==asset.body.captureId || asset.body.kind!=="session") throw new Error("Fixture media ownership is not confirmed."); await del(asset.body.location); }
        for(const asset of assets) await db.query("DELETE FROM records WHERE workspace_id=$1 AND kind='media' AND id=$2",[workspace,asset.id]);
        await db.query(`DELETE FROM records WHERE workspace_id=$1 AND kind='session_capture' AND body->>'gameId'=$2`,[workspace,gameId]);
        await db.query("DELETE FROM session_capture_grants WHERE workspace_id=$1 AND game_id=$2",[workspace,gameId]);
        await db.query("DELETE FROM events WHERE workspace_id=$1 AND game_id=$2",[workspace,gameId]);
        await db.query("DELETE FROM player_first_seen WHERE workspace_id=$1 AND game_id=$2",[workspace,gameId]);
        await db.query("DELETE FROM records WHERE workspace_id=$1 AND kind='game' AND id=$2",[workspace,gameId]);
        if (await db.get(workspace,"game",gameId)) throw new Error("Fixture game cleanup did not complete.");
        if (result) result.cleanup="fixture-scoped cleanup completed";
        await unlink(recovery);
      } catch { if(result) result.cleanup="incomplete; private recovery pointer retained"; console.error(`Fixture cleanup incomplete; private recovery pointer retained at ${recovery}`);process.exitCode=1; }
    } else await unlink(recovery).catch(()=>{});
    await db.closeDatabase();
  }
  return result;
}

try { if (mode === "public") console.log(JSON.stringify({public:await publicChecks(), authentication:"not tested",fixtureCapture:"not run",foreverOrJev:"not tested"})); else await liveChecks(); }
catch (error) { console.error(error instanceof PublicCheckError ? error.message : "Release acceptance failed or was not configured; no credential values or callback URLs are logged.");process.exitCode=1; }
