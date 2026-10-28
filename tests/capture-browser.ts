// Real Chromium + MediaRecorder privacy/codec smoke test, with a local mock capture API.
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import ffmpeg from 'ffmpeg-static';
import assert from 'node:assert/strict';
import { inspectCaptureVideo } from '../src/lib/capture-video';

const dir=await mkdtemp(join(tmpdir(),'gm-capture-'));
const server=createServer(async(req,res)=>{
  if(req.url==='/sdk.js') {res.setHeader('Content-Type','text/javascript');res.end(await readFile('public/sdk.js'));return;}
  res.setHeader('Content-Type','text/html');res.end(`<!doctype html><canvas id="game" width="320" height="180"></canvas><input id="private" value="DOM_PRIVATE_SENTINEL"><div>CHAT_PRIVATE_SENTINEL</div><script src="/sdk.js"></script><script>const c=document.querySelector('#game'),x=c.getContext('2d');x.fillStyle='#ff0000';x.fillRect(0,0,320,180);</script>`);
});
await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
const port=(server.address() as any).port;let uploaded:Buffer | undefined;let uploads=0;let recordedAt="",eventAt="",grantAt=0;
const browser=await chromium.launch({headless:true});
try {
  const page=await browser.newPage();
  await page.route('**/api/**',async route=>{
    const url=new URL(route.request().url());
    if(url.pathname==='/api/collect') { const event=JSON.parse(route.request().postData()!).events[0]; if(event.name==='round_start') eventAt=event.timestamp; return route.fulfill({status:200,body:'{}',contentType:'application/json'}); }
    if(url.pathname==='/api/capture/start') { grantAt=Date.now();await new Promise(r=>setTimeout(r,550));return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({status:'pending',captureId:'id',token:'private-token',config:{enabled:true,surfaceReviewed:true,canvasSelector:'#game',maxDurationSeconds:3,masks:[{x:.25,y:.25,width:.5,height:.5}]}})}); }
    if(url.pathname==='/api/capture/upload') {uploads++;const body=route.request().postDataBuffer()!;const boundary=route.request().headers()['content-type'].split('boundary=')[1];const start=body.indexOf(Buffer.from('Content-Type: video/'));const dataStart=body.indexOf(Buffer.from('\r\n\r\n'),start)+4;const end=body.indexOf(Buffer.from('\r\n--'+boundary),dataStart);uploaded=body.subarray(dataStart,end);const match=body.toString('latin1').match(/name="recordedAt"\r\n\r\n([^\r]+)/);recordedAt=match?.[1]||'';return route.fulfill({status:200,contentType:'application/json',body:'{"status":"ready"}'});}
    return route.fulfill({status:200,body:'{}'});
  });
  await page.goto(`http://127.0.0.1:${port}`);
  await page.evaluate(()=>{(window as any).Blaze.init({endpoint:location.origin,sdkKey:'fixture'});});
  assert.equal((await page.evaluate(()=>(window as any).Blaze.startCapture({consent:true}))).status,'consent_required');assert.equal(uploads,0);
  await page.evaluate(()=>(window as any).Blaze.setConsent(true));
  assert.equal((await page.evaluate(()=>(window as any).Blaze.startCapture({consent:true}))).status,'recording');
  await page.waitForTimeout(400);await page.evaluate(()=>(window as any).Blaze.track('round_start'));await page.waitForTimeout(1200);
  assert.equal((await page.evaluate(()=>(window as any).Blaze.stopCapture())).status,'ready');
  assert.equal(uploads,1);assert.ok(uploaded && uploaded.length>0 && uploaded.length<=3145728);
  const offset=(Date.parse(eventAt)-Date.parse(recordedAt))/1000;assert.ok(Date.parse(recordedAt)-grantAt>=500);assert.ok(offset>=.35 && offset<.65,`event offset ${offset}`);assert.ok((Date.parse(eventAt)-grantAt)/1000-offset>=.5);
  const inspected=await inspectCaptureVideo(uploaded!,3);
  assert.equal(inspected.width,320);assert.equal(inspected.height,180);assert.ok(inspected.fps<=5.5);
  const video=join(dir,'capture.webm');await writeFile(video,uploaded!);
  assert.ok(ffmpeg);const decoded=spawnSync(ffmpeg!,['-v','error','-i',video,'-frames:v','1','-f','rawvideo','-pix_fmt','rgb24','pipe:1'],{maxBuffer:2*1024*1024});
  assert.equal(decoded.status,0,decoded.stderr.toString());assert.equal(decoded.stdout.length,320*180*3);
  function pixel(x:number,y:number){const i=(y*320+x)*3;return Array.from(decoded.stdout.subarray(i,i+3));}
  const outer=pixel(20,20), masked=pixel(160,90);
  assert.ok(outer[0]>180 && outer[1]<50 && outer[2]<50,`outside: ${outer}`);
  assert.ok(masked.every(v=>v<25),`mask: ${masked}`);
  console.log(JSON.stringify({result:'pass',browser:'Chromium MediaRecorder',bytes:uploaded!.length,width:320,height:180,outer,masked,uploads,inspected,delayedGrantMs:Date.parse(recordedAt)-grantAt,eventOffsetSeconds:offset,domOutsideCanvas:true}));
} finally {await browser.close();server.close();await rm(dir,{recursive:true,force:true});}
