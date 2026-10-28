/** Controlled local acceptance: actual SDK, canvas recorder, authenticated API and private storage. */
import { chromium } from "playwright";
import { spawnSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
import ffmpeg from "ffmpeg-static";
import { inspectCaptureVideo } from "../src/lib/capture-video";

const base = "http://127.0.0.1:3000";
const output = "/Users/macbook/Documents/Codex/2026-10-28/web-game-marketing-build/outputs";
const login = await fetch(`${base}/api/auth/dev`, { method:"POST", headers:{ Origin:base } });
assert.equal(login.status, 200, "local test sign-in");
const cookie = login.headers.get("set-cookie")!.split(";")[0];
async function action(body:object) {
  const r = await fetch(`${base}/api/actions`, { method:"POST", headers:{Origin:base,Cookie:cookie,"Content-Type":"application/json"}, body:JSON.stringify(body) });
  if (!r.ok) throw Error(`action ${r.status}: ${await r.text()}`);
  return r.json();
}
const { game } = await action({ action:"add_game", url:`${base}/fixture/index.html`, title:"Segmented capture acceptance fixture" });
await action({ action:"update_game", id:game.id, capture:{enabled:true,canvasSelector:"#game",surfaceReviewed:true,sampleRate:1,maxDurationSeconds:30,maxSegments:4,retentionDays:1,maxCapturesPerDay:25,masks:[{x:0,y:0,width:.25,height:.25}]} });
const browser = await chromium.launch({headless:true,args:["--disk-cache-size=1","--media-cache-size=1"]});
const context = await browser.newContext({viewport:{width:1440,height:900}});
const [cookieName, ...cookieValue] = cookie.split("=");
await context.addCookies([{name:cookieName,value:cookieValue.join("="),url:base}]);
let sessionId = "";
let fixturePage: import("playwright").Page | undefined;
try {
  const page = await context.newPage();
  fixturePage = page;
  const captureResponses: {path:string;status:number}[] = [];
  let lateProgressionObserved = false;
  let waitFrom = 0;
  page.on("request", request => { if (new URL(request.url()).pathname === "/api/collect") { try { const body=request.postDataJSON(); if (body.events?.some((event:{name:string;timestamp:string}) => event.name === "progression" && Date.parse(event.timestamp) >= waitFrom && waitFrom > 0)) lateProgressionObserved = true; } catch {} } });
  page.on("response", response => { const path=new URL(response.url()).pathname; if(path.startsWith("/api/capture/")) captureResponses.push({path,status:response.status()}); });
  await page.goto(`${base}/fixture/index.html`,{waitUntil:"domcontentloaded"});
  await page.getByText("Optional telemetry for this fixture").click();
  await page.locator("#sdk-key").fill(game.sdkKey);
  await page.locator("#enable-tracking").click();
  await page.getByText("Optional gameplay recording").click();
  await page.evaluate(() => { (window as any).__captureStates = []; window.addEventListener("blaze:capturestatus", (event) => (window as any).__captureStates.push((event as CustomEvent).detail.status)); });
  await page.locator("#start-capture").click();
  await page.getByText("Recording the game canvas. Stop to save or discard.").waitFor();
  const wallStart=Date.now();
  sessionId = (await page.evaluate((key)=>sessionStorage.getItem(`gm_session_${key}_id`),game.sdkKey))!;
  assert.ok(sessionId, "SDK session created");
  await page.locator("#start").click();
  await page.locator("#right").click();
  await page.waitForTimeout(35000);
  await page.waitForFunction(() => (window as any).__captureStates.filter((state:string) => state === "recording").length >= 2, null, {timeout:20000});
  // Real game input resets the fixture; it naturally emits a progression when the first star is caught.
  waitFrom = Date.now();
  await page.locator("#start").click();
  for (let attempt=0; attempt<10 && !lateProgressionObserved; attempt++) await page.waitForTimeout(1000);
  assert.ok(lateProgressionObserved,"fixture emitted a later progression after real input");
  await page.waitForTimeout(500);
  await page.locator("#stop-capture").click();
  await page.getByText("Recording saved privately.").waitFor({timeout:30000});
  async function detail() {
    const response=await fetch(`${base}/api/sessions/${encodeURIComponent(sessionId)}?gameId=${encodeURIComponent(game.id)}`,{headers:{Cookie:cookie}});
    assert.equal(response.status,200); return response.json();
  }
  let body=await detail();
  const captures=body.captures as Array<{id:string;segment:number;status:string;recordedAt:string;durationSeconds:number;videoUrl:string}>;
  assert.equal(captures.length,2,`expected two captures: ${JSON.stringify(captures)}`);
  assert.ok(captures.every(c=>c.status==="ready" && c.videoUrl),"two saved capture segments");
  const [first,second]=captures;
  assert.equal(first.segment,0); assert.equal(second.segment,1);
  assert.ok(first.durationSeconds>=29 && first.durationSeconds<=30.1,`first segment duration ${first.durationSeconds}`);
  const lateEvent=body.events.find((event:{name:string;timestamp:string})=>event.name==="progression" && Date.parse(event.timestamp)-Date.parse(first.recordedAt)>=35000 && Date.parse(event.timestamp)>=Date.parse(second.recordedAt) && Date.parse(event.timestamp)<=Date.parse(second.recordedAt)+second.durationSeconds*1000);
  assert.ok(lateEvent,"real game progression after 35 seconds within second segment");
  const expectedOffset=(Date.parse(lateEvent.timestamp)-Date.parse(second.recordedAt))/1000;
  const media: Array<{segment:number;bytes:number;durationSeconds:number;fps:number;width:number;height:number;anonymousStatus:number;ownerStatus:number;decodedFrame:boolean}> = [];
  for (const capture of captures) {
    const anon=await fetch(base+capture.videoUrl); assert.equal(anon.status,401);
    const res=await fetch(base+capture.videoUrl,{headers:{Cookie:cookie}}); assert.equal(res.status,200);
    const bytes=Buffer.from(await res.arrayBuffer()); const inspected=await inspectCaptureVideo(bytes,30);
    const decoded=spawnSync(ffmpeg!,["-v","error","-i","pipe:0","-frames:v","1","-f","rawvideo","-pix_fmt","rgb24","pipe:1"],{input:bytes,maxBuffer:2*1024*1024});
    assert.equal(decoded.status,0,decoded.stderr.toString()); assert.equal(decoded.stdout.length,720*400*3);
    media.push({segment:capture.segment+1,bytes:bytes.length,durationSeconds:inspected.durationSeconds,fps:inspected.fps,width:inspected.width,height:inspected.height,anonymousStatus:anon.status,ownerStatus:res.status,decodedFrame:true});
  }
  // No navigation has happened: an absent exit event must not be treated as evidence of a cause.
  const exit=body.events.findLast((event:{name:string})=>event.name==="exit");
  const coverageBeforeWithdrawal = body.coverage;
  const app=await context.newPage();
  await app.goto(`${base}/app`,{waitUntil:"domcontentloaded"});
  await app.getByRole("navigation").getByRole("button",{name:"Sessions",exact:true}).click();
  await app.getByLabel("Filter by game").selectOption(game.id);
  await app.getByRole("row").filter({hasText:sessionId.slice(0,8)}).click();
  await app.getByLabel("Capture segment").waitFor();
  const seek=app.getByRole("button",{name:/Progression.*segment 2/}).first();
  await seek.click();
  await app.waitForFunction(({url,offset})=>{const v=document.querySelector<HTMLVideoElement>('video[aria-label="Player canvas capture"]');return v?.getAttribute("src")===url && Math.abs(v.currentTime-offset)<0.35;},{url:second.videoUrl,offset:expectedOffset},{timeout:15000});
  assert.equal(await app.getByLabel("Capture segment").inputValue(),second.id);
  await app.screenshot({path:`${output}/replay-segments-inspector.png`,fullPage:true});
  // Withdraw while the original SDK still holds both capture grants.
  await page.bringToFront();
  const withdrawal=await page.evaluate(async()=>typeof (window as any).Blaze?.disable === "function" ? (window as any).Blaze.disable() : null);
  assert.ok(withdrawal && withdrawal.status==="cancelled","withdraw consent from live SDK capture series");
  const afterStatuses=[] as number[];
  for(const capture of captures){const res=await fetch(base+capture.videoUrl,{headers:{Cookie:cookie}});afterStatuses.push(res.status);assert.ok([404,410].includes(res.status),`withdrawn segment still available: ${res.status}`);}
  body=await detail();
  assert.ok(body.captures.every((c:{status:string;videoUrl?:string})=>c.status!=="ready" && !c.videoUrl),"all session segments withdrawn");
  const report={checkedAt:new Date().toISOString(),scope:"Controlled local Star Catch fixture; not a Jev or real-game validation",gameId:game.id,sessionId,elapsedMs:Date.now()-wallStart,firstRecordedAt:first.recordedAt,secondRecordedAt:second.recordedAt,lateEvent:{name:lateEvent.name,timestamp:lateEvent.timestamp,secondsAfterFirst:(Date.parse(lateEvent.timestamp)-Date.parse(first.recordedAt))/1000,segmentOffsetSeconds:expectedOffset},seekedSegment:2,exit:{observed:!!exit,timestamp:exit?.timestamp || null,meaning:exit ? "Observed SDK exit; no cause inferred" : "No exit recorded before withdrawal; no cause inferred"},coverage:coverageBeforeWithdrawal,media,withdrawal:{status:withdrawal.status,afterStatuses},captureResponses};
  await writeFile(`${output}/replay-segments-acceptance.json`,JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2));
} finally {
  if (fixturePage && !fixturePage.isClosed()) await fixturePage.evaluate(async () => { if (typeof (window as any).Blaze?.disable === "function") await (window as any).Blaze.disable(); }).catch(() => {});
  await browser.close();
}
