// Controlled real-Chromium acceptance: no network and no Forever data.
import { chromium } from "playwright";
import { spawnSync } from "node:child_process";
import ffmpeg from "ffmpeg-static";
import { strict as assert } from "node:assert";
const browser=await chromium.launch({headless:true});
try {
  const page=await browser.newPage();
  await page.setContent(`<canvas id="capture" width="100" height="100"></canvas><iframe sandbox="allow-scripts" srcdoc="&lt;script&gt;let port;addEventListener('message',async e=&gt;{if(e.source!==parent)return;if(e.data.type==='handshake'){port=e.ports[0];return}if(e.data.type==='draw' &amp;&amp; port){const c=document.createElement('canvas');c.width=10;c.height=10;const ctx=c.getContext('2d');ctx.fillStyle='red';ctx.fillRect(0,0,10,10);const bitmap=await createImageBitmap(c);port.postMessage({v:1,nonce:'abcdefghijklmnopqrstuvwx',seq:e.data.seq,type:'frame',at:e.data.stale?Date.now()-5000:Date.now(),bitmap},[bitmap]);}});&lt;/script&gt;"></iframe>`);
  await page.addScriptTag({path:"public/sdk.js"});
  await page.evaluate("window.__name = (fn) => fn");
  await page.evaluate(()=>{
    const w=window as any;w.calls=[];w.uploaded=null;w.fetch=async (url:string,request:any)=>{w.calls.push(url);if(url.endsWith('/api/collect'))return {ok:true};if(url.endsWith('/api/capture/start'))return {ok:true,json:async()=>({status:'pending',captureId:'test-capture',token:'test-token',config:{enabled:true,surfaceReviewed:true,canvasSelector:'#capture',masks:[],maxDurationSeconds:3,maxSegments:1}})};if(url.endsWith('/api/capture/upload')){w.recordedAt=request.body.get('recordedAt');w.uploaded=Array.from(new Uint8Array(await request.body.get('file').arrayBuffer()));return {ok:true,json:async()=>({status:'ready'})}}return {ok:true,json:async()=>({})}};
    w.Blaze.init({endpoint:'https://marketing.example',sdkKey:'test-key',consent:true});const iframe=document.querySelector('iframe')!,canvas=document.querySelector('canvas')!,channel=new MessageChannel();
    w.bridge=w.Blaze.attachFrame({frame:iframe,port:channel.port1,nonce:'abcdefghijklmnopqrstuvwx',canvas});iframe.contentWindow!.postMessage({type:'handshake'},'*',[channel.port2]);
    w.gateStarted=Date.now();w.started=w.Blaze.startCapture({consent:true});
  });
  await page.waitForFunction(()=> (window as any).calls.some((url:string)=>url.endsWith('/api/capture/start')));
  await page.waitForTimeout(100);
  await page.evaluate(()=>document.querySelector('iframe')!.contentWindow!.postMessage({type:'draw',seq:1,stale:true},'*'));
  await page.waitForTimeout(250);const prior=await page.evaluate(()=>(window as any).Blaze.getCaptureState());assert.equal(prior.status,'starting',JSON.stringify(prior));
  const freshAt=await page.evaluate(()=>{document.querySelector('iframe')!.contentWindow!.postMessage({type:'draw',seq:2},'*');return Date.now()});
  await page.waitForFunction(()=>(window as any).Blaze.getCaptureState().status==='recording');
  await page.waitForTimeout(1100);assert.equal(await page.evaluate(async()=> (await (window as any).Blaze.stopCapture()).status),'ready');
  const result=await page.evaluate(()=>({at:(window as any).recordedAt,gate:(window as any).gateStarted,bytes:(window as any).uploaded}));
  assert.ok(Date.parse(result.at)>=freshAt && Date.parse(result.at)-result.gate>=300);
  assert.ok(ffmpeg);const decoded=spawnSync(ffmpeg!,['-v','error','-i','pipe:0','-frames:v','1','-f','rawvideo','-pix_fmt','rgb24','pipe:1'],{input:Buffer.from(result.bytes),maxBuffer:100*100*3+1024});
  assert.equal(decoded.status,0);const pixel=[...decoded.stdout.subarray((75*100+75)*3,(75*100+75)*3+3)];assert.ok(pixel[0]>180 && pixel[1]<70 && pixel[2]<70,`first frame pixel ${pixel}`);
  console.log('PASS fresh first frame before real MediaRecorder start, stale frame rejection, real recordedAt, nonblank first video frame; all endpoints mocked');
} finally {await browser.close();}
