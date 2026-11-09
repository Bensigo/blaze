import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { webcrypto } from "node:crypto";
import { MessageChannel, MessagePort } from "node:worker_threads";

function harness(agent = false) {
  const requests: any[] = [], fetchCalls: string[] = [], calls:{url:string;request:any}[] = [], handlers = new Map<string, Set<Function>>(), frameHandlers = new Map<string, Set<Function>>(), drawings: string[] = [], timers = new Map<number, Function>(); let timer = 0;
  const on = (map: Map<string, Set<Function>>, name: string, fn: Function) => { if (!map.has(name)) map.set(name, new Set()); map.get(name)!.add(fn); };
  const off = (map: Map<string, Set<Function>>, name: string, fn: Function) => map.get(name)?.delete(fn);
  class Frame { isConnected = true; contentWindow = {}; addEventListener(n:string,f:Function){on(frameHandlers,n,f)} removeEventListener(n:string,f:Function){off(frameHandlers,n,f)} }
  class Canvas { isConnected = true; width=640; height=360; getContext(){return {drawImage:()=>drawings.push('draw'),clearRect:()=>drawings.push('clear'),getImageData:()=>({}),fillRect:()=>drawings.push('mask'),fillStyle:''}} captureStream(){return {getVideoTracks:()=>[{requestFrame(){},stop(){}}],getTracks:()=>[{stop(){}}]}} }
  class Bitmap { width=640; height=360; closed=false; close(){this.closed=true} }
  class Click { type='click'; isTrusted=true; timeStamp=0; }
  class Recorder { static isTypeSupported(){return true} state='inactive'; onstop?:()=>void; ondataavailable?:Function; constructor(..._args:any[]){} start(){this.state='recording'} stop(){this.state='inactive';this.ondataavailable?.({data:new Blob(['v'])});this.onstop?.()} }
  const canvas = new Canvas(), frame = new Frame(), store=()=>({getItem:()=>null,setItem:()=>{}});
  const document:any={readyState:'complete',referrer:'',hidden:false,hasFocus:()=>true,addEventListener(n:string,f:Function){on(handlers,n,f)},removeEventListener(n:string,f:Function){off(handlers,n,f)},querySelectorAll:()=>[canvas],createElement:()=>new Canvas()};
  const window:any={crypto:webcrypto,__WEB_GAME_STUDIO_AGENT__:agent,localStorage:store(),sessionStorage:store(),HTMLIFrameElement:Frame,HTMLCanvasElement:Canvas,ImageBitmap:Bitmap,Event:Click,navigator:{userActivation:{isActive:true}},MessagePort,MediaRecorder:Recorder,addEventListener(n:string,f:Function){on(handlers,n,f)},removeEventListener(n:string,f:Function){off(handlers,n,f)},dispatchEvent(e:any){handlers.get(e.type)?.forEach(f=>f(e))},CustomEvent:class{type:string;detail:any;constructor(type:string,opts:any){this.type=type;this.detail=opts.detail}}};
  const fetch=vi.fn((url:string, req:any)=>{fetchCalls.push(url);calls.push({url,request:req});if(url.endsWith('/api/collect')){requests.push(JSON.parse(req.body));return Promise.resolve({ok:true})} if(url.endsWith('/api/capture/start'))return Promise.resolve({ok:true,json:async()=>({status:'pending',captureId:'cap',token:'t',config:{enabled:true,surfaceReviewed:true,canvasSelector:'#canvas',masks:[],maxDurationSeconds:30,maxSegments:4}})});return Promise.resolve({ok:true,json:async()=>({status:'ready'})})});
  runInNewContext(readFileSync('public/sdk.js','utf8'),{window,document,crypto:webcrypto,location:{href:'https://game.example/'},navigator:{userAgent:'test'},innerWidth:100,innerHeight:100,URL,fetch,Date,Math,Number,Array,Object,Blob,FormData,AbortController,Promise,setInterval:(f:Function)=>{timers.set(++timer,f);return timer},clearInterval:(n:number)=>timers.delete(n),setTimeout,clearTimeout});
  const sdk=window.Blaze, nonce='abcdefghijklmnopqrstuvwx';
  return {sdk,nonce,frame,canvas,Canvas,Bitmap,Click,window,document,requests,fetchCalls,calls,drawings,frameHandlers,handlers,tick:()=>[...timers.values()].forEach(f=>f()), attach(surface=canvas,previewMasks?:any[]){const channel=new MessageChannel();const bridge=sdk.attachFrame({frame,port:channel.port1,nonce,canvas:surface,previewMasks});return {bridge,port:channel.port2,receive:channel.port1 as MessagePort & {onmessage?: (event: {data: unknown}) => void}}}};
}
const waitForPort = () => new Promise(r=>setTimeout(r,10));
afterEach(()=>{vi.restoreAllMocks();vi.useRealTimers()});
describe('private frame bridge v1',()=>{
  it('accepts only consented, scoped, ordered, constrained lifecycle messages',async()=>{
    const h=harness();h.sdk.init({endpoint:'https://marketing.example',sdkKey:'key'});const {bridge,port}=h.attach();
    port.postMessage({v:1,nonce:h.nonce,seq:1,type:'event',name:'round_start'});await waitForPort();expect(h.requests).toHaveLength(0);
    h.sdk.setConsent(true);h.requests.length=0;
    port.postMessage({v:1,nonce:'wrong',seq:2,type:'event',name:'round_start'});
    port.postMessage({v:1,nonce:h.nonce,seq:2,type:'event',name:'round_start',hiddenCards:['private']});
    port.postMessage({v:1,nonce:h.nonce,seq:2,type:'event',name:'round_start'});
    port.postMessage({v:1,nonce:h.nonce,seq:2,type:'event',name:'round_complete',properties:{result:'win'}});
    port.postMessage({v:1,nonce:h.nonce,seq:3,type:'event',name:'round_complete',properties:{result:'win',name:'private'}});
    port.postMessage({v:1,nonce:h.nonce,seq:3,type:'event',name:'round_complete',properties:{result:'win'}});
    await waitForPort();expect(h.requests.map(r=>r.events[0].name)).toEqual(['round_start','active_play','round_complete']);expect(JSON.stringify(h.requests)).not.toContain('private');
    bridge.close();port.postMessage({v:1,nonce:h.nonce,seq:4,type:'event',name:'retry'});await waitForPort();expect(h.requests).toHaveLength(3);port.close();
  });
  it('uses fresh sampled child activity only while a consented foreground round is running',async()=>{
    const clock=vi.spyOn(Date,'now');let now=1_800_000_000_000;clock.mockImplementation(()=>now);
    const h=harness();h.sdk.init({endpoint:'https://marketing.example',sdkKey:'key',consent:true});const {bridge,port}=h.attach();
    port.postMessage({v:1,nonce:h.nonce,seq:1,type:'event',name:'round_start'});await waitForPort();
    port.postMessage({v:1,nonce:h.nonce,seq:2,type:'activity',at:now,isTrusted:true});
    port.postMessage({v:1,nonce:h.nonce,seq:3,type:'activity',at:now-5000});
    port.postMessage({v:1,nonce:h.nonce,seq:4,type:'activity',at:now});await waitForPort();now+=4000;h.tick();
    const events=h.requests.flatMap(r=>r.events);expect(events.filter(e=>e.name==='active_play').at(-1).properties.duration).toBe(4);
    bridge.close();port.close();
  });
  it('closes received bitmaps without drawing until recording is separately consented',async()=>{
    const clock=vi.spyOn(Date,'now');let now=1_800_000_000_000;clock.mockImplementation(()=>now);
    const h=harness();h.sdk.init({endpoint:'https://marketing.example',sdkKey:'key',consent:true});const {bridge,port,receive}=h.attach();
    const frame=(seq:number,bitmap:any)=>receive.onmessage!({data:{v:1,nonce:h.nonce,seq,type:'frame',bitmap,at:now}} as any);
    const before=new h.Bitmap();frame(1,before);expect(before.closed).toBe(true);expect(h.drawings.filter(x=>x==='draw')).toHaveLength(0);
    const starting=h.sdk.startCapture({consent:true});await waitForPort();frame(2,new h.Bitmap());expect((await starting).status).toBe('recording');now+=201;
    const beforeFrame=h.drawings.filter(x=>x==='draw').length;
    const valid=new h.Bitmap();frame(3,valid);expect(valid.closed).toBe(true);expect(h.drawings.filter(x=>x==='draw').length).toBe(beforeFrame+1);
    const wrong=new h.Bitmap();receive.onmessage!({data:{v:1,nonce:'wrong',seq:4,type:'frame',bitmap:wrong}} as any);expect(wrong.closed).toBe(true);
    await h.sdk.stopCapture({discard:true});bridge.close();port.close();
  });
  it('does not draw onto a canvas other than the server-selected capture surface',async()=>{
    const h=harness();h.sdk.init({endpoint:'https://marketing.example',sdkKey:'key',consent:true});const {bridge,port,receive}=h.attach(new h.Canvas());
    expect((await h.sdk.startCapture({consent:true})).status).toBe('recording');const count=h.drawings.filter(x=>x==='draw').length;
    const bitmap=new h.Bitmap();receive.onmessage!({data:{v:1,nonce:h.nonce,seq:1,type:'frame',bitmap}} as any);expect(bitmap.closed).toBe(true);expect(h.drawings.filter(x=>x==='draw')).toHaveLength(count);
    await h.sdk.stopCapture({discard:true});bridge.close();port.close();
  });
  it('waits for a fresh matching timestamped frame and records actual start time',async()=>{
    const clock=vi.spyOn(Date,'now');let now=1_800_000_000_000;clock.mockImplementation(()=>now);
    const h=harness();h.sdk.init({endpoint:'https://marketing.example',sdkKey:'key',consent:true});const {bridge,port,receive}=h.attach();
    let complete=false;const starting=h.sdk.startCapture({consent:true}).then((value:any)=>{complete=true;return value});await waitForPort();
    const frame=(seq:number,at:number,nonce=h.nonce)=>receive.onmessage!({data:{v:1,nonce,seq,type:'frame',at,bitmap:new h.Bitmap()}} as any);
    frame(1,now-1000);frame(2,now,'wrong');receive.onmessage!({data:{v:1,nonce:h.nonce,seq:2,type:'frame',bitmap:new h.Bitmap()}} as any);await Promise.resolve();expect(complete).toBe(false);expect(h.sdk.getCaptureState().status).toBe('starting');
    now+=700;frame(3,now);expect((await starting).status).toBe('recording');const actualStart=now;now+=1000;
    expect((await h.sdk.stopCapture()).status).toBe('ready');
    const upload=h.calls.find(c=>c.url.endsWith('/api/capture/upload'));expect(upload?.request.body.get('recordedAt')).toBe(new Date(actualStart).toISOString());
    bridge.close();port.close();
  });
  it('fails without upload on missing first frame and cancels safely on withdrawal or navigation',async()=>{
    vi.useFakeTimers();vi.setSystemTime(new Date('2026-01-01T12:00:00Z'));
    const h=harness();h.sdk.init({endpoint:'https://marketing.example',sdkKey:'key',consent:true});const first=h.attach();
    const starting=h.sdk.startCapture({consent:true});await vi.advanceTimersByTimeAsync(0);await vi.advanceTimersByTimeAsync(3001);
    expect(await starting).toMatchObject({status:'failed',reason:'frame_timeout'});expect(h.fetchCalls.some(x=>x.endsWith('/api/capture/upload'))).toBe(false);first.bridge.close();first.port.close();
    const a=harness();a.sdk.init({endpoint:'https://marketing.example',sdkKey:'key',consent:true});const second=a.attach();const withdrawing=a.sdk.startCapture({consent:true});await vi.advanceTimersByTimeAsync(0);await a.sdk.disable();expect((await withdrawing).status).toBe('cancelled');expect(a.fetchCalls.some(x=>x.endsWith('/api/capture/upload'))).toBe(false);second.port.close();
    const b=harness();b.sdk.init({endpoint:'https://marketing.example',sdkKey:'key',consent:true});const third=b.attach();const navigating=b.sdk.startCapture({consent:true});await vi.advanceTimersByTimeAsync(0);b.frameHandlers.get('load')?.forEach(f=>f());expect(await navigating).toMatchObject({status:'failed',reason:'frame_unavailable'});expect(b.fetchCalls.some(x=>x.endsWith('/api/capture/upload'))).toBe(false);third.port.close();
    const c=harness();c.canvas.getContext=()=>({drawImage:()=>{throw new Error('unavailable')},clearRect:()=>0,getImageData:()=>({}),fillRect:()=>0,fillStyle:''});c.sdk.init({endpoint:'https://marketing.example',sdkKey:'key',consent:true});const fourth=c.attach();const broken=c.sdk.startCapture({consent:true});await vi.advanceTimersByTimeAsync(0);const bitmap=new c.Bitmap();fourth.receive.onmessage!({data:{v:1,nonce:c.nonce,seq:1,type:'frame',at:Date.now(),bitmap}} as any);expect(await broken).toMatchObject({status:'failed',reason:'frame_unavailable'});expect(bitmap.closed).toBe(true);expect(c.fetchCalls.some(x=>x.endsWith('/api/capture/upload'))).toBe(false);fourth.bridge.close();fourth.port.close();
  });
  it('requires a new frame for every segment and records the second segment start after it arrives',async()=>{
    vi.useFakeTimers();vi.setSystemTime(new Date('2026-01-01T12:00:00Z'));
    const h=harness();h.sdk.init({endpoint:'https://marketing.example',sdkKey:'key',consent:true});const {bridge,port,receive}=h.attach();
    const frame=(seq:number,at:number)=>receive.onmessage!({data:{v:1,nonce:h.nonce,seq,type:'frame',at,bitmap:new h.Bitmap()}} as any);
    const first=h.sdk.startCapture({consent:true});await vi.advanceTimersByTimeAsync(0);const old=Date.now();frame(1,old);expect((await first).status).toBe('recording');
    await vi.advanceTimersByTimeAsync(30001);expect(h.sdk.getCaptureState().status).toBe('starting');frame(2,old);await Promise.resolve();expect(h.sdk.getCaptureState().status).toBe('starting');
    await vi.advanceTimersByTimeAsync(500);const secondStart=Date.now();frame(3,secondStart);await vi.advanceTimersByTimeAsync(0);expect(h.sdk.getCaptureState().status).toBe('recording');
    await vi.advanceTimersByTimeAsync(1000);expect((await h.sdk.stopCapture()).status).toBe('ready');
    const uploads=h.calls.filter(c=>c.url.endsWith('/api/capture/upload'));expect(uploads).toHaveLength(2);expect(uploads[0].request.body.get('recordedAt')).toBe(new Date(old).toISOString());expect(uploads[1].request.body.get('recordedAt')).toBe(new Date(secondStart).toISOString());
    bridge.close();port.close();
  });
  it('allows a bounded masked local preview without consent or network activity',()=>{
    vi.useFakeTimers();vi.setSystemTime(new Date('2026-01-01T12:00:00Z'));
    const h=harness();h.sdk.init({endpoint:'https://marketing.example',sdkKey:'key'});const {bridge,port,receive}=h.attach(h.canvas,[{x:.25,y:.25,width:.5,height:.5}]);
    expect(()=>bridge.startPreview({type:'click',isTrusted:true})).toThrow();
    const fake=new h.Click();fake.isTrusted=false;expect(()=>bridge.startPreview(fake)).toThrow();
    h.window.navigator.userActivation.isActive=false;expect(()=>bridge.startPreview(new h.Click())).toThrow();h.window.navigator.userActivation.isActive=true;
    const click=new h.Click();expect(bridge.startPreview(click)).toMatchObject({status:'previewing',expiresAt:'2026-01-01T12:00:30.000Z'});expect(()=>bridge.startPreview(click)).toThrow();
    const send=(seq:number)=>{const bitmap=new h.Bitmap();receive.onmessage!({data:{v:1,nonce:h.nonce,seq,type:'frame',bitmap}} as any);expect(bitmap.closed).toBe(true)};
    send(1);send(2);expect(h.drawings.filter(x=>x==='draw')).toHaveLength(1);expect(h.drawings.filter(x=>x==='mask')).toHaveLength(1);expect(h.fetchCalls).toHaveLength(0);
    vi.advanceTimersByTime(30000);expect(h.drawings.at(-1)).toBe('clear');send(3);expect(h.drawings.filter(x=>x==='draw')).toHaveLength(1);
    bridge.startPreview(new h.Click());h.canvas.width=3000;send(4);expect(h.drawings.at(-1)).toBe('clear');expect(h.drawings.filter(x=>x==='draw')).toHaveLength(1);
    bridge.close();port.close();
  });
  it('clears preview on hide, withdrawal, navigation, stop and recording start',async()=>{
    const h=harness();h.sdk.init({endpoint:'https://marketing.example',sdkKey:'key'});let b=h.attach();
    b.bridge.startPreview(new h.Click());h.document.hidden=true;h.handlers.get('visibilitychange')?.forEach(f=>f());expect(h.drawings.at(-1)).toBe('clear');h.document.hidden=false;
    b.bridge.startPreview(new h.Click());b.bridge.stopPreview();expect(h.drawings.at(-1)).toBe('clear');
    b.bridge.startPreview(new h.Click());h.sdk.setConsent(false);expect(h.frameHandlers.get('load')?.size).toBe(0);b.port.close();
    h.sdk.setConsent(true);b=h.attach();b.bridge.startPreview(new h.Click());const starting=h.sdk.startCapture({consent:true});await waitForPort();b.receive.onmessage!({data:{v:1,nonce:h.nonce,seq:1,type:'frame',bitmap:new h.Bitmap(),at:Date.now()}} as any);expect((await starting).status).toBe('recording');expect(()=>b.bridge.startPreview(new h.Click())).toThrow();await h.sdk.stopCapture({discard:true});
    b.bridge.startPreview(new h.Click());h.frameHandlers.get('load')?.forEach(f=>f());expect(h.frameHandlers.get('load')?.size).toBe(0);b.port.close();
  });
  it('accepts scoped, consented and rate-limited game pointers but emits no events during preview',()=>{
    const clock=vi.spyOn(Date,'now');let now=1_800_000_000_000;clock.mockImplementation(()=>now);
    const h=harness();h.sdk.init({endpoint:'https://marketing.example',sdkKey:'key'});const {bridge,port,receive}=h.attach();
    const msg=(v:any)=>receive.onmessage!({data:{v:1,nonce:h.nonce,...v}} as any);
    msg({seq:1,type:'pointer',x:.2,y:.3,screen:'board'});expect(h.requests).toHaveLength(0);
    h.sdk.setConsent(true);h.requests.length=0;
    msg({seq:2,type:'pointer',x:-.1,y:.3,screen:'board'});msg({seq:2,type:'pointer',x:.2,y:2,screen:'board'});msg({seq:2,type:'pointer',x:.2,y:.3,screen:'https://evil'});msg({seq:2,type:'pointer',x:.2,y:.3,screen:'board',name:'private'});
    msg({seq:2,type:'pointer',x:.2,y:.3,screen:'board'});msg({seq:3,type:'pointer',x:.4,y:.5,screen:'board'});
    expect(h.requests).toHaveLength(1);expect(h.requests[0].events[0].properties).toEqual({x:.2,y:.3,surface:'game',screen:'board'});
    now+=1000;h.document.hidden=true;msg({seq:4,type:'pointer',x:.1,y:.1,screen:'board'});h.document.hidden=false;
    bridge.startPreview(new h.Click());msg({seq:5,type:'pointer',x:.3,y:.4,screen:'board'});msg({seq:6,type:'event',name:'round_start'});msg({seq:7,type:'activity',at:now});h.handlers.get('pointerdown')?.forEach(f=>f({clientX:20,clientY:30,isTrusted:true}));expect(h.requests).toHaveLength(1);
    bridge.stopPreview();now+=1000;msg({seq:8,type:'pointer',x:.3,y:.4,screen:'board'});expect(h.requests).toHaveLength(2);
    now+=1000;h.handlers.get('pointerdown')?.forEach(f=>f({clientX:20,clientY:30,isTrusted:true}));expect(h.requests.at(-1).events[0].properties).toEqual({x:.2,y:.3,surface:'viewport',screen:'viewport'});
    bridge.close();port.close();
  });
  it('closes on frame navigation and consent withdrawal and emits nothing in marked worker sessions',async()=>{
    const h=harness(true);h.sdk.init({endpoint:'https://marketing.example',sdkKey:'key',consent:true});const {port}=h.attach();
    port.postMessage({v:1,nonce:h.nonce,seq:1,type:'event',name:'round_start'});port.postMessage({v:1,nonce:h.nonce,seq:2,type:'pointer',x:.5,y:.5,screen:'board'});await waitForPort();expect(h.requests).toHaveLength(0);
    h.frameHandlers.get('load')?.forEach(f=>f());expect(h.frameHandlers.get('load')?.size).toBe(0);port.close();
    const x=harness();x.sdk.init({endpoint:'https://marketing.example',sdkKey:'key',consent:true});const second=x.attach();x.sdk.setConsent(false);expect(x.frameHandlers.get('load')?.size).toBe(0);second.port.close();
  });
});
