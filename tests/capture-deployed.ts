// Explicitly opted-in acceptance for the new product's production deployment only.
// Creates and removes its own isolated workspace, identities, and capture Blob.
import { chromium } from 'playwright';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { del } from '@vercel/blob';
import ffmpeg from 'ffmpeg-static';
import assert from 'node:assert/strict';

if (process.env.ALLOW_LIVE_ACCEPTANCE !== 'true') throw Error('Explicit ALLOW_LIVE_ACCEPTANCE=true is required.');
const base=process.env.RELEASE_BASE_URL;
if (base !== 'https://web-game-marketing.vercel.app') throw Error('Use the exact new product production origin.');
process.loadEnvFile('.env.vercel.local');process.loadEnvFile('.env.release.local');
if (!process.env.DATABASE_URL || !process.env.BLOB_READ_WRITE_TOKEN || !process.env.WORKER_TOKEN || !process.env.CREDENTIAL_KEY) throw Error('Release database, private Blob, worker, and signing credentials are required.');
const db=await import('../src/lib/db');
const {inspectCaptureVideo}=await import('../src/lib/capture-video');
const {signMedia}=await import('../src/lib/security');
const suffix=randomUUID().replaceAll('-','');
const workspace=`capture_release_${suffix}`, foreignWorkspace=`capture_foreign_${suffix}`;
const ownerId=`release_owner_${suffix}`, foreignId=`release_foreign_${suffix}`;
const gameId=db.id('game'),sdkKey=db.id('sdk');
const ownerToken=randomBytes(32).toString('base64url'),foreignToken=randomBytes(32).toString('base64url');
const digest=(token:string)=>createHash('sha256').update(token).digest('hex');
const ownerCookie=`studio_session=${ownerToken}`,foreignCookie=`studio_session=${foreignToken}`;
const output='/Users/macbook/Documents/Codex/2026-10-28/web-game-marketing-build/outputs';
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
try {
  const health=await fetch(base+'/api/health');assert.equal(health.status,200,'production health');
  assert.equal((await fetch(base+'/api/workspace')).status,401);
  assert.equal((await fetch(base+'/api/auth/dev',{method:'POST',headers:{Origin:base}})).status,404);
  for(const [id,ws,token] of [[ownerId,workspace,ownerToken],[foreignId,foreignWorkspace,foreignToken]]) {
    await db.query('INSERT INTO users(id,email,name,workspace_id) VALUES($1,$2,$3,$4)',[id,`${id}@example.invalid`,'Temporary acceptance owner',ws]);
    await db.query("INSERT INTO auth_sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '1 hour')",[digest(token),id]);
  }
  const config={enabled:false,canvasSelector:'#game',surfaceReviewed:true,sampleRate:1,maxDurationSeconds:5,retentionDays:1,maxCapturesPerDay:25,masks:[{x:0,y:0,width:.25,height:.25}]};
  const game={id:gameId,title:'Capture release acceptance',url:base+'/fixture/index.html',description:'Temporary isolated fixture.',image:base+'/fixture/cover.svg',genre:'Fixture',sdkKey,origins:[base],createdAt:new Date().toISOString(),dailyEnabled:false,competitors:[],capture:config};
  await db.put(workspace,'game',game);
  browser=await chromium.launch({headless:true,args:['--disk-cache-size=1','--media-cache-size=1']});
  const disabled=await browser.newPage();await disabled.goto(base+'/fixture/index.html');
  let uploads=0;disabled.on('request',r=>{if(r.url().endsWith('/api/capture/upload'))uploads++;});
  assert.equal((await disabled.evaluate(()=>(window as any).GameMarketing.startCapture({consent:true}))).status,'consent_required');
  await disabled.evaluate(key=>(window as any).GameMarketing.init({endpoint:location.origin,sdkKey:key,consent:true}),sdkKey);
  assert.equal((await disabled.evaluate(()=>(window as any).GameMarketing.startCapture({consent:true}))).status,'disabled');assert.equal(uploads,0);await disabled.close();
  await db.put(workspace,'game',{...game,capture:{...config,enabled:true}});
  const page=await browser.newPage();await page.goto(base+'/fixture/index.html');
  await page.evaluate(key=>(window as any).GameMarketing.init({endpoint:location.origin,sdkKey:key,consent:true}),sdkKey);
  assert.equal((await page.evaluate(()=>(window as any).GameMarketing.startCapture({consent:false}))).status,'consent_required');
  await page.getByText('Optional gameplay recording').click();
  await page.locator('#fixture-private-input').fill('DOM_INPUT_SENTINEL');
  await page.locator('#fixture-chat').evaluate(e=>e.textContent='DOM_CHAT_SENTINEL');
  await page.locator('#game').evaluate((node:HTMLCanvasElement)=>{const x=node.getContext('2d')!;x.fillStyle='#ff00ff';x.fillRect(0,0,100,100);x.fillStyle='#00ff00';x.fillRect(200,150,100,100);});
  const start=await page.evaluate(()=>(window as any).GameMarketing.startCapture({consent:true}));assert.equal(start.status,'recording',JSON.stringify(start));
  await page.waitForTimeout(1000);
  const ready=await page.evaluate(()=>(window as any).GameMarketing.stopCapture());assert.equal(ready.status,'ready',JSON.stringify(ready));
  const sessionId=await page.evaluate(key=>sessionStorage.getItem('gm_session_'+key+'_id'),sdkKey);assert.ok(sessionId);
  const detailsPath=`/api/sessions/${sessionId}?gameId=${gameId}`;
  const details=await fetch(base+detailsPath,{headers:{Cookie:ownerCookie}});assert.equal(details.status,200);
  const detail=await details.json();assert.equal(detail.capture.status,'ready');
  assert.equal(new Date(detail.capture.recordedAt).toISOString(),detail.capture.recordedAt);
  const {loadAgentHistory}=await import('../src/lib/agent-history');
  await db.put(workspace,'post',{id:db.id('post'),gameId,text:'Release history acceptance draft',channel:'x',status:'draft',createdAt:new Date().toISOString(),campaignId:'release-history-check'});
  await db.put(foreignWorkspace,'post',{id:db.id('post'),gameId,text:'FOREIGN_HISTORY_SENTINEL',channel:'x',status:'draft',createdAt:new Date().toISOString(),campaignId:'foreign-check'});
  const history=await loadAgentHistory(workspace,gameId);
  assert.equal(history.totals.visits,2);
  assert.ok(history.posts.some(p=>p.text==='Release history acceptance draft'));
  assert.ok(!JSON.stringify(history).includes('FOREIGN_HISTORY_SENTINEL'));
  assert.ok(!JSON.stringify(history).includes(sessionId));
  const research=await fetch(base+'/api/actions',{method:'POST',headers:{Origin:base,Cookie:ownerCookie,'Content-Type':'application/json'},body:JSON.stringify({action:'run_research',gameId})});
  assert.equal(research.status,200);
  const researchBody=await research.json();
  assert.notEqual(researchBody.run.status,'failed');
  assert.equal(researchBody.run.coverage.find((c:{source:string})=>c.source==='AI research agent')?.status,'disconnected');
  assert.equal((await fetch(base+detailsPath,{headers:{Cookie:foreignCookie}})).status,404);
  const mediaUrl=detail.capture.videoUrl as string;const mid=mediaUrl.split('/').pop()!;
  assert.equal((await fetch(base+mediaUrl)).status,401);
  assert.equal((await fetch(base+mediaUrl,{headers:{Cookie:foreignCookie}})).status,404);
  assert.equal((await fetch(base+mediaUrl,{headers:{Authorization:`Bearer ${process.env.WORKER_TOKEN}`}})).status,401);
  const expiry=Date.now()+60000,signature=await signMedia(mid,expiry);
  assert.equal((await fetch(`${base}/api/share-media/${mid}?expires=${expiry}&signature=${signature}`)).status,404);
  const range=await fetch(base+mediaUrl,{headers:{Cookie:ownerCookie,Range:'bytes=0-31'}});assert.equal(range.status,206);
  const response=await fetch(base+mediaUrl,{headers:{Cookie:ownerCookie}});assert.equal(response.status,200);
  const bytes=Buffer.from(await response.arrayBuffer());assert.ok(bytes.length>0&&bytes.length<=3145728);
  const info=await inspectCaptureVideo(bytes,5);assert.equal(info.width,720);assert.equal(info.height,400);assert.ok(info.fps<=5.5);
  const decoded=spawnSync(ffmpeg!,['-v','error','-i','pipe:0','-frames:v','1','-f','rawvideo','-pix_fmt','rgb24','pipe:1'],{input:bytes,maxBuffer:2*1024*1024});assert.equal(decoded.status,0);
  function pixel(x:number,y:number){const i=(y*720+x)*3;return [...decoded.stdout.subarray(i,i+3)];}
  const masked=pixel(50,50),outside=pixel(250,200);assert.ok(masked.every(v=>v<25));assert.ok(outside[1]>180);
  await writeFile(output+'/human-capture-production-fixture.webm',bytes);
  await page.evaluate(()=>(window as any).GameMarketing.disable());
  assert.ok([404,410].includes((await fetch(base+mediaUrl,{headers:{Cookie:ownerCookie}})).status));
  const report={checkedAt:new Date().toISOString(),url:base,fixture:'isolated controlled game',consent:'disabled and missing consent produced no capture',bytes:bytes.length,width:info.width,height:info.height,durationSeconds:info.durationSeconds,fps:info.fps,audio:'none',maskedPixel:masked,outsidePixel:outside,ownerPlayback:'200 and range 206',anonymous:'401',foreign:'404',worker:'401',publicShare:'404',withdrawal:'denied after cancellation',domOutsideCanvas:true,agentHistory:'Real PostgreSQL projection included current game posts and human aggregates; foreign workspace and raw session ID excluded. No live model call.',research:'Baseline checks completed; missing AI connection explicitly disconnected.'};
  await writeFile(output+'/human-capture-production-evidence.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
} finally {
  await browser?.close();
  // Keep durable DB pointers if Blob cleanup fails, so a later retry can find them.
  let cleanupFailed=false;
  for (const kind of ['media','media_storage_intent']) {
    const assets=await db.list<{location:string;backend:string}>(workspace,kind);
    for (const asset of assets) if(asset.backend==='blob') try {await del(asset.location);} catch {cleanupFailed=true;}
  }
  if(!cleanupFailed){
    await db.query('DELETE FROM session_capture_grants WHERE workspace_id=$1',[workspace]);
    for(const ws of [workspace,foreignWorkspace]) for(const table of ['events','jobs','records','credentials','daily_runs','publish_dispatches']) await db.query(`DELETE FROM ${table} WHERE workspace_id=$1`,[ws]);
    await db.query('DELETE FROM auth_sessions WHERE user_id=$1 OR user_id=$2',[ownerId,foreignId]);
    await db.query('DELETE FROM users WHERE id=$1 OR id=$2',[ownerId,foreignId]);
    console.log('Removed isolated release identities, records, and test media.');
  } else {console.error('Isolated release cleanup incomplete; durable media pointers retained for retry.');process.exitCode=1;}
}
