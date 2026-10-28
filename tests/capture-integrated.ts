import { chromium } from 'playwright';
import { spawnSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { inspectCaptureVideo } from '../src/lib/capture-video';
import assert from 'node:assert/strict';
import ffmpeg from 'ffmpeg-static';

const base='http://127.0.0.1:3000';
const output='/Users/macbook/Documents/Codex/2026-10-28/web-game-marketing-build/outputs';
const login=await fetch(base+'/api/auth/dev',{method:'POST',headers:{Origin:base}});
assert.equal(login.status,200,'local auth');
const cookie=login.headers.get('set-cookie')!.split(';')[0];
async function action(body:object){const r=await fetch(base+'/api/actions',{method:'POST',headers:{Origin:base,Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify(body)});if(!r.ok)throw Error(`action ${r.status}: ${await r.text()}`);return r.json();}
const {game}=await action({action:'add_game',url:base+'/fixture/index.html'});
await action({action:'update_game',id:game.id,capture:{enabled:true,canvasSelector:'#game',surfaceReviewed:true,sampleRate:1,maxDurationSeconds:5,retentionDays:1,maxCapturesPerDay:25,masks:[{x:0,y:0,width:.25,height:.25}]}});
const browser=await chromium.launch({headless:true,args:['--disk-cache-size=1','--media-cache-size=1']});
try {
  const page=await browser.newPage();
  if (process.env.CAPTURE_GRANT_DELAY) await page.route('**/api/capture/start',async route=>{const response=await route.fetch();await new Promise(r=>setTimeout(r,600));await route.fulfill({response});});
  let uploads=0;page.on('request',r=>{if(r.url().endsWith('/api/capture/upload'))uploads++;});
  await page.goto(base+'/fixture/index.html');
  await page.getByText('Optional gameplay recording').click();
  await page.locator('#fixture-private-input').fill('DOM_INPUT_SENTINEL');
  await page.locator('#fixture-chat').evaluate(e=>e.textContent='DOM_CHAT_SENTINEL');
  assert.equal((await page.evaluate(()=>(window as any).GameMarketing.startCapture({consent:true}))).status,'consent_required');
  assert.equal(uploads,0);
  await page.evaluate((key)=>{(window as any).GameMarketing.init({endpoint:location.origin,sdkKey:key,consent:true});},game.sdkKey);
  assert.equal((await page.evaluate(()=>(window as any).GameMarketing.startCapture({consent:false}))).status,'consent_required');
  assert.equal(uploads,0);
  // Paint non-private test colors directly into the game surface so the mask is observable.
  await page.locator('#game').evaluate((node:HTMLCanvasElement)=>{const x=node.getContext('2d')!;x.fillStyle='#ff00ff';x.fillRect(0,0,100,100);x.fillStyle='#00ff00';x.fillRect(200,150,100,100);});
  const started=await page.evaluate(()=>(window as any).GameMarketing.startCapture({consent:true}));
  assert.equal(started.status,'recording',JSON.stringify(started));
  if (process.env.CAPTURE_GAMEPLAY) { await page.waitForTimeout(500); await page.locator('#start').click(); await page.waitForTimeout(300); await page.locator('#right').click(); await page.waitForTimeout(1400); }
  else await page.waitForTimeout(Number(process.env.CAPTURE_TEST_MS || 1000));
  const result=await page.evaluate(()=>(window as any).GameMarketing.stopCapture());
  assert.equal(result.status,'ready',JSON.stringify(result));assert.equal(uploads,1);
  const sid=await page.evaluate((key)=>sessionStorage.getItem('gm_session_'+key+'_id'),game.sdkKey);
  const detail=await fetch(`${base}/api/sessions/${sid}?gameId=${game.id}`,{headers:{Cookie:cookie}});assert.equal(detail.status,200);
  const body=await detail.json();assert.equal(body.capture.status,'ready');const videoUrl=body.capture.videoUrl;
  if (process.env.CAPTURE_GRANT_DELAY) { const capture=body.capture;const startEvent=body.events.find((e:any)=>e.name==='round_start');assert.ok(startEvent);const actualOffset=(Date.parse(startEvent.timestamp)-Date.parse(capture.recordedAt))/1000;const oldOffset=(Date.parse(startEvent.timestamp)-Date.parse(capture.createdAt))/1000;assert.ok(actualOffset>=0.3&&actualOffset<0.9,`actual event offset ${actualOffset}`);assert.ok(oldOffset-actualOffset>=0.5,`grant delay ${oldOffset-actualOffset}`); }
  assert.equal((await fetch(base+videoUrl)).status,401);
  const range=await fetch(base+videoUrl,{headers:{Cookie:cookie,Range:'bytes=0-31'}});assert.equal(range.status,206);
  const media=await fetch(base+videoUrl,{headers:{Cookie:cookie}});assert.equal(media.status,200);
  const bytes=Buffer.from(await media.arrayBuffer());assert.ok(bytes.length<=3145728);
  const inspect=await inspectCaptureVideo(bytes,5);assert.equal(inspect.width,720);assert.equal(inspect.height,400);assert.ok(inspect.fps<=5.5);
  const decoded=spawnSync(ffmpeg!,['-v','error','-i','pipe:0','-frames:v','1','-f','rawvideo','-pix_fmt','rgb24','pipe:1'],{input:bytes,maxBuffer:2*1024*1024});
  assert.equal(decoded.status,0,decoded.stderr.toString());assert.equal(decoded.stdout.length,720*400*3);
  function pixel(x:number,y:number){const i=(y*720+x)*3;return [...decoded.stdout.subarray(i,i+3)];}
  const masked=pixel(50,50),outside=pixel(250,200);
  assert.ok(masked.every(v=>v<25),`masked=${masked}`);assert.ok(outside.some(v=>v>25),`outside=${outside}`);
  const artifact=output+'/human-capture-local-fixture.webm';if (!process.env.CAPTURE_GAMEPLAY) await writeFile(artifact,bytes);
  let afterStatus:number | undefined;
  if (!process.env.CAPTURE_KEEP) { await page.evaluate(()=>(window as any).GameMarketing.disable()); const after=await fetch(base+videoUrl,{headers:{Cookie:cookie}});afterStatus=after.status;assert.ok([404,410].includes(after.status),`after cancel ${after.status}`); }
  const report={checkedAt:new Date().toISOString(),local:true,game:'controlled Star Catch fixture',consent:'analytics and recording required',result:process.env.CAPTURE_KEEP?'ready':'ready then cancelled',gameId:game.id,sessionId:sid,bytes:bytes.length,width:inspect.width,height:inspect.height,durationSeconds:inspect.durationSeconds,fps:inspect.fps,audio:'none (server inspected)',maskedPixel:masked,outsidePixel:outside,anonymousStatus:401,ownerRangeStatus:206,afterCancelStatus:afterStatus,domOutsideCanvas:true,artifact};
  if (!process.env.CAPTURE_GAMEPLAY) await writeFile(output+'/human-capture-local-evidence.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
} finally {await browser.close();}
