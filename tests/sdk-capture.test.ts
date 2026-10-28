import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { webcrypto } from 'node:crypto';

function deferred<T>() { let resolve!: (value:T)=>void; const promise=new Promise<T>(r=>{resolve=r}); return {promise,resolve}; }
function harness(options: {tainted?:boolean; delayedVisit?:boolean; delayedUpload?:boolean; oversized?:boolean; unsupported?:boolean} = {}) {
  const calls: {url:string; options:any}[]=[]; const events:any[]=[]; const drawings:any[]=[]; const handlers:Record<string,Function>={};
  const visit=deferred<any>(), upload=deferred<any>();
  class Canvas {
    width=1920; height=1080;
    getContext() { return {drawImage:()=>drawings.push(['draw']),getImageData:()=>{if(options.tainted) throw Error('tainted')},fillRect:(...args:number[])=>drawings.push(['mask',...args]),fillStyle:''}; }
    captureStream() { return {getVideoTracks:()=>[{requestFrame() {},stop() {}}],getTracks:()=>[{stop() {}}]}; }
  }
  const source=new Canvas();
  class Recorder {
    static isTypeSupported(type:string) { return !options.unsupported && type.startsWith('video/webm'); }
    state='inactive'; ondataavailable:any; onstop:any; onerror:any;
    constructor(_stream:any, public settings:any) {}
    start() {this.state='recording';}
    stop() { this.state='inactive'; queueMicrotask(()=>{this.ondataavailable?.({data:new Blob([options.oversized?new Uint8Array(3145729):'video'],{type:'video/webm'})});this.onstop?.();}); }
  }
  const store=()=>({getItem:()=>null,setItem:()=>{}});
  const document:any={readyState:'complete',referrer:'',hidden:false,addEventListener(name:string, fn:Function){handlers[name]=fn;},querySelectorAll:()=>[source],createElement:()=>new Canvas()};
  const window:any={crypto:webcrypto,localStorage:store(),sessionStorage:store(),HTMLCanvasElement:Canvas,MediaRecorder:Recorder,addEventListener(name:string,fn:Function){handlers[name]=fn;},dispatchEvent:(e:any)=>events.push(e.detail),CustomEvent:class {detail:any;constructor(_name:string, args:any){this.detail=args.detail}}};
  const grant={status:'pending',captureId:'capture-1',token:'secret-token',config:{enabled:true,surfaceReviewed:true,canvasSelector:'#game',maxDurationSeconds:30,masks:[{x:.25,y:.25,width:.5,height:.5}]}};
  const fetch=vi.fn((url:string, request:any)=>{calls.push({url,options:request});if(url.endsWith('/api/collect')) return options.delayedVisit && JSON.parse(request.body).events[0].name==='visit'?visit.promise:Promise.resolve({ok:true});if(url.endsWith('/api/capture/start'))return Promise.resolve({ok:true,json:async()=>grant});if(url.endsWith('/api/capture/upload'))return options.delayedUpload?upload.promise:Promise.resolve({ok:true,json:async()=>({status:'ready'})});return Promise.resolve({ok:true,json:async()=>({})});});
  runInNewContext(readFileSync('public/sdk.js','utf8'),{window,document,crypto:webcrypto,location:{href:'https://game.example/'},navigator:{userAgent:'test'},innerWidth:100,innerHeight:100,URL,fetch,Date,Math,Number,Array,Blob,FormData,AbortController,Promise,setInterval,clearInterval,setTimeout,clearTimeout});
  return {sdk:window.GameMarketing,calls,events,drawings,visit,upload,grant,document,handlers};
}

describe('consented canvas capture',()=>{
  it('requires both consents and waits for the stored visit',async()=>{
    const h=harness({delayedVisit:true});h.sdk.init({endpoint:'https://marketing.example',sdkKey:'key'});
    expect((await h.sdk.startCapture({consent:true})).status).toBe('consent_required');
    h.sdk.setConsent(true);expect((await h.sdk.startCapture({consent:false})).status).toBe('consent_required');
    const start=h.sdk.startCapture({consent:true});await Promise.resolve();
    expect(h.calls.some(c=>c.url.endsWith('/api/capture/start'))).toBe(false);
    h.visit.resolve({ok:true});expect((await start).status).toBe('recording');
    expect(h.calls.find(c=>c.url.endsWith('/api/capture/start'))?.options.credentials).toBe('omit');
    await h.sdk.stopCapture({discard:true});
  });
  it('copies only the canvas, masks scaled pixels and uploads bounded video without leaking its token in events',async()=>{
    const h=harness();h.sdk.init({endpoint:'https://marketing.example',sdkKey:'key',consent:true});
    expect((await h.sdk.startCapture({consent:true})).status).toBe('recording');
    expect(h.drawings).toEqual([['draw'],['mask',240,135,480,270],['draw'],['mask',240,135,480,270]]);
    expect((await h.sdk.stopCapture()).status).toBe('ready');
    const request=h.calls.find(c=>c.url.endsWith('/api/capture/upload'))!;
    expect(request.options.credentials).toBe('omit');
    expect(request.options.body.get('width')).toBe('960');expect(request.options.body.get('height')).toBe('540');
    expect(request.options.body.get('file').size).toBeLessThanOrEqual(3145728);
    expect(JSON.stringify(h.events)).not.toContain('secret-token');
  });
  it('fails closed for a tainted canvas and reports a stable reason',async()=>{
    const h=harness({tainted:true});h.sdk.init({endpoint:'https://marketing.example',sdkKey:'key',consent:true});
    expect((await h.sdk.startCapture({consent:true})).reason).toBe('canvas_not_origin_clean');
    expect(h.calls.some(c=>c.url.endsWith('/api/capture/upload'))).toBe(false);
    expect(JSON.parse(h.calls.find(c=>c.url.endsWith('/api/capture/status'))!.options.body)).toMatchObject({status:'failed',reason:'canvas_not_origin_clean'});
  });
  it('refuses unsupported codecs and malformed masks without uploading',async()=>{
    const noCodec=harness({unsupported:true});noCodec.sdk.init({endpoint:'https://marketing.example',sdkKey:'key',consent:true});
    expect((await noCodec.sdk.startCapture({consent:true}))).toMatchObject({status:'unsupported',reason:'codec_unavailable'});
    const invalid=harness();invalid.grant.config.masks[0].width=2;invalid.sdk.init({endpoint:'https://marketing.example',sdkKey:'key',consent:true});
    expect((await invalid.sdk.startCapture({consent:true}))).toMatchObject({status:'failed',reason:'invalid_masks'});
    expect([...noCodec.calls,...invalid.calls].some(c=>c.url.endsWith('/api/capture/upload'))).toBe(false);
  });
  it('rejects oversized recorder chunks instead of uploading them',async()=>{
    const h=harness({oversized:true});h.sdk.init({endpoint:'https://marketing.example',sdkKey:'key',consent:true});
    await h.sdk.startCapture({consent:true});expect((await h.sdk.stopCapture())).toMatchObject({status:'failed',reason:'size_limit'});
    expect(h.calls.some(c=>c.url.endsWith('/api/capture/upload'))).toBe(false);
  });
  it('finalizes when hidden and discards a recording on page exit',async()=>{
    const hidden=harness();hidden.sdk.init({endpoint:'https://marketing.example',sdkKey:'key',consent:true});
    await hidden.sdk.startCapture({consent:true});hidden.document.hidden=true;hidden.handlers.visibilitychange();
    await new Promise(r=>setTimeout(r,0));
    expect(hidden.sdk.getCaptureState().status).toBe('ready');
    const exiting=harness();exiting.sdk.init({endpoint:'https://marketing.example',sdkKey:'key',consent:true});
    await exiting.sdk.startCapture({consent:true});exiting.handlers.pagehide();await new Promise(r=>setTimeout(r,0));
    expect(exiting.sdk.getCaptureState().status).toBe('cancelled');
    expect(exiting.calls.some(c=>c.url.endsWith('/api/capture/upload'))).toBe(false);
    expect(exiting.calls.some(c=>c.url.endsWith('/api/capture/cancel'))).toBe(true);
  });
  it('cancels again after a late upload response when consent is withdrawn',async()=>{
    const h=harness({delayedUpload:true});h.sdk.init({endpoint:'https://marketing.example',sdkKey:'key',consent:true});
    await h.sdk.startCapture({consent:true});const saving=h.sdk.stopCapture();await new Promise(r=>setTimeout(r,0));
    const withdrawal=h.sdk.disable();h.upload.resolve({ok:true,json:async()=>({status:'ready'})});
    await Promise.all([saving,withdrawal]);
    expect(h.sdk.getCaptureState().status).toBe('cancelled');
    expect(h.calls.filter(c=>c.url.endsWith('/api/capture/cancel')).length).toBe(2);
  });
});
