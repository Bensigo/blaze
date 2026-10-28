import { chromium } from "playwright";
import { strict as assert } from "node:assert";
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.setContent(`<button id="review">Review preview</button><canvas id="review-surface" width="100" height="100"></canvas><iframe id="game" sandbox="allow-scripts" srcdoc="&lt;script&gt;let port;addEventListener('message', async e =&gt; { if(e.source!==parent)return; if(e.data.type==='handshake'){port=e.ports[0];return} if(e.data.type==='draw' &amp;&amp; port){const c=document.createElement('canvas');c.width=10;c.height=10;c.getContext('2d').fillStyle='red';c.getContext('2d').fillRect(0,0,10,10);const bitmap=await createImageBitmap(c);port.postMessage({v:1,nonce:'abcdefghijklmnopqrstuvwx',seq:e.data.seq,type:'frame',bitmap},[bitmap]);}});&lt;/script&gt;"></iframe>`);
  await page.addScriptTag({path:'public/sdk.js'});
  await page.evaluate(() => {
    const w=window as any;w.calls=[];w.fetch=(...args:any[])=>{w.calls.push(args[0]);return Promise.resolve({ok:true})};
    w.Blaze.init({endpoint:'https://marketing.example',sdkKey:'test-key'});
    const frame=document.querySelector('iframe')!,canvas=document.querySelector('canvas')!,channel=new MessageChannel();
    w.bridge=w.Blaze.attachFrame({frame,port:channel.port1,nonce:'abcdefghijklmnopqrstuvwx',canvas,previewMasks:[{x:0,y:0,width:.5,height:.5}]});
    frame.contentWindow!.postMessage({type:'handshake'},'*',[channel.port2]);
    document.querySelector('button')!.addEventListener('click', e=>{try{w.result=w.bridge.startPreview(e)}catch(error){w.error=(error as Error).message}});
  });
  await page.evaluate(() => (document.querySelector('button') as HTMLButtonElement).click());
  assert.match(await page.evaluate(() => (window as any).error), /trusted/);
  await page.click('#review');
  assert.equal(await page.evaluate(() => (window as any).result?.status), 'previewing');
  await page.evaluate(() => document.querySelector('iframe')!.contentWindow!.postMessage({type:'draw',seq:1},'*'));
  await page.waitForFunction(() => {const ctx=(document.querySelector('canvas') as HTMLCanvasElement).getContext('2d')!;return ctx.getImageData(75,75,1,1).data[0]===255});
  const pixels=await page.evaluate(()=>{const ctx=(document.querySelector('canvas') as HTMLCanvasElement).getContext('2d')!;return {masked:Array.from(ctx.getImageData(25,25,1,1).data),game:Array.from(ctx.getImageData(75,75,1,1).data),calls:(window as any).calls.length}});
  assert.deepEqual(pixels.masked,[0,0,0,255]);assert.deepEqual(pixels.game,[255,0,0,255]);assert.equal(pixels.calls,0);
  await page.evaluate(()=>(window as any).bridge.stopPreview());
  assert.equal(await page.evaluate(()=>(document.querySelector('canvas') as HTMLCanvasElement).getContext('2d')!.getImageData(75,75,1,1).data[3]),0);
  console.log('PASS real trusted click, sandboxed MessagePort ImageBitmap preview, mask, no network, and canvas clear');
} finally { await browser.close(); }
