import { createServer, type Server } from 'node:https';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Duplex } from 'node:stream';
import { chromium, type Browser, type BrowserServer } from 'playwright';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { installBrowserPolicy, prepareBrowserPolicy, resolverRules } from '../worker/network-policy';

let server: Server, browser: Browser, browserServer: BrowserServer, dir: string, port: number;
let arrivals: { path: string; capability?: string }[] = []; let redirects = 0;
const sockets = new Set<Duplex>();
beforeAll(async () => {
  dir=mkdtempSync(join(tmpdir(),'blaze-frame-'));
  execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',join(dir,'key'),'-out',join(dir,'cert'),'-days','1','-subj','/CN=game.test','-addext','subjectAltName=DNS:game.test,DNS:cdn.test,IP:127.0.0.1'],{stdio:'ignore'});
  server=createServer({key:readFileSync(join(dir,'key')),cert:readFileSync(join(dir,'cert'))},(req,res)=>{
    arrivals.push({path:req.url || '',capability:req.headers['x-blaze-synthetic-capability'] as string | undefined});
    if (req.url==='/initial') { res.writeHead(302,{location:'/landing'}); res.end(); return; }
    if (req.url==='/foreign-start') { res.writeHead(302,{location:`https://cdn.test:${port}/foreign-landing`}); res.end(); return; }
    if (req.url==='/frame-redirect') { redirects++; res.writeHead(302,{location:redirects===1 ? `https://127.0.0.1:${port}/private` : '/other'}); res.end(); return; }
    res.setHeader('Content-Type','text/html'); res.end('<!doctype html><title>fixture</title>');
  });
  server.on('connection', socket => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)); });
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve)); port=(server.address() as AddressInfo).port;
});
afterAll(async()=>{for (const socket of sockets) socket.destroy(); server.closeAllConnections(); await Promise.all([browserServer?.kill(), new Promise<void>(resolve=>server.close(()=>resolve()))]); rmSync(dir,{recursive:true,force:true});},10000);
it('sends the capability once only and permits only sandboxed exact frames without redirect escapes',async()=>{
  const origin=`https://game.test:${port}`;
  const policy=await prepareBrowserPolicy({url:`${origin}/initial`,host:'game.test',ip:'8.8.8.8',local:false},{resourceOrigins:[`https://cdn.test:${port}`],webSocketOrigins:[],frameUrls:[`${origin}/frame`,`${origin}/frame-redirect`]},false,async()=>[{address:'8.8.8.8',family:4}]);
  policy.pins.set('game.test','127.0.0.1'); policy.pins.set('cdn.test','127.0.0.1');
  browserServer=await chromium.launchServer({headless:true,args:['--no-proxy-server','--disable-quic',`--host-resolver-rules=${resolverRules(policy)}`]});
  browser=await chromium.connect(browserServer.wsEndpoint());
  const context=await browser.newContext({ignoreHTTPSErrors:true,serviceWorkers:'block'}); const page=await context.newPage();
  await installBrowserPolicy(context,page,policy,()=>{},undefined,{url:`${origin}/initial`,capability:'secret-capability'});
  await page.goto(`${origin}/initial`,{waitUntil:'domcontentloaded'});
  await page.evaluate((origin)=>{ for(const path of ['/frame','/frame-redirect','/other']) { const frame=document.createElement('iframe'); frame.src=origin+path; document.body.appendChild(frame); } },origin);
  await page.waitForTimeout(1200);
  await page.evaluate((origin)=>{ const frame=document.createElement('iframe'); frame.src=origin+'/frame-redirect'; document.body.appendChild(frame); },origin);
  await page.waitForTimeout(500);
  const frame=page.frames().find(f=>f.url()===`${origin}/frame`); expect(frame).toBeTruthy();
  expect(await frame!.evaluate(()=>{try{return !!parent.document.body}catch{return false}})).toBe(false);
  expect(arrivals.find(x=>x.path==='/initial')?.capability).toBe('secret-capability');
  expect(arrivals.filter(x=>x.path!=='/initial').every(x=>!x.capability)).toBe(true);
  expect(arrivals.some(x=>x.path==='/frame')).toBe(true);
  expect(arrivals.filter(x=>x.path==='/frame-redirect')).toHaveLength(2);
  expect(arrivals.some(x=>x.path==='/private' || x.path==='/other')).toBe(false);
  await context.close();
  const second=await browser.newContext({ignoreHTTPSErrors:true,serviceWorkers:'block'}); const page2=await second.newPage();
  await installBrowserPolicy(second,page2,policy,()=>{},undefined,{url:`${origin}/foreign-start`,capability:'second-secret'});
  await expect(page2.goto(`${origin}/foreign-start`,{waitUntil:'domcontentloaded'})).rejects.toThrow();
  expect(arrivals.find(x=>x.path==='/foreign-start')?.capability).toBe('second-secret');
  expect(arrivals.some(x=>x.path==='/foreign-landing')).toBe(false);
  await second.close(); await browser.close();
},30000);
