/** Controlled investigation UI acceptance; API data and footage are test fixtures. */
import { chromium, type Route } from "playwright";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import ffmpeg from "ffmpeg-static";
import assert from "node:assert/strict";
import { buildDemo } from "../src/lib/demo";
const tempDir=await mkdtemp(join(tmpdir(), "blaze-investigation-"));
const videoPath=join(tempDir, "fixture.webm");
const encode=spawnSync(ffmpeg!,["-v","error","-f","lavfi","-i","color=c=green:s=320x180:r=5","-t","2","-an","-c:v","libvpx",videoPath]);
assert.equal(encode.status,0,encode.stderr.toString());
const bytes=await readFile(videoPath);
const demo=buildDemo(), game={...demo.games[0],id:"investigation-game",title:"Investigation fixture"};
const session={...demo.analytics.sessionsList[0],id:"investigation-session",gameId:game.id};
const end=new Date().toISOString(), start=new Date(Date.now()-86400000).toISOString();
const recordedAt=new Date(Date.now()-10000).toISOString(), eventAt=new Date(Date.parse(recordedAt)+1000).toISOString();
const points=[
 {gameId:game.id,surface:"game",screen:"battle",device:"desktop",bx:2,by:3,x:.125,y:.175,count:4},
 {gameId:game.id,surface:"viewport",screen:"unknown",device:"mobile",bx:7,by:8,x:.375,y:.425,count:2},
];
const workspace={...demo,demo:false,user:{name:"Test",email:"test@example.test"},games:[game],analytics:{...demo.analytics,windowEnd:end,heatmap:points,dropoffs:[{name:"Viewed, no round start",count:1}],sessionsList:[session],sessionPage:{limit:100,total:1}}};
const capture={id:"capture-2",segment:1,status:"ready",gameId:game.id,sessionId:session.id,createdAt:recordedAt,recordedAt,expiresAt:new Date(Date.now()+86400000).toISOString(),durationSeconds:2,width:320,height:180,videoUrl:"/investigation-video.webm"};
const queries:URL[]=[];
const browser=await chromium.launch({headless:true}); const page=await browser.newPage({viewport:{width:1280,height:900}});
page.setDefaultTimeout(45000);
page.on("pageerror", error => console.error("Browser error:", error.message));
const json=(r:Route,v:unknown)=>r.fulfill({status:200,contentType:"application/json",body:JSON.stringify(v)});
await page.route("**/*",async route=>{const u=new URL(route.request().url());
 if(u.pathname==="/investigation-video.webm") {
  const range=route.request().headers().range?.match(/^bytes=(\d+)-(\d*)$/);
  if (range) { const start=Number(range[1]), end=Math.min(bytes.length-1,range[2] ? Number(range[2]) : bytes.length-1); return route.fulfill({status:206,headers:{"Content-Type":"video/webm","Accept-Ranges":"bytes","Content-Range":`bytes ${start}-${end}/${bytes.length}`},body:bytes.subarray(start,end+1)}); }
  return route.fulfill({status:200,headers:{"Content-Type":"video/webm","Accept-Ranges":"bytes"},body:bytes});
 }
 if(u.pathname==="/api/auth/config")return json(route,{googleConfigured:true});
 if(u.pathname==="/api/workspace")return json(route,workspace);
 if(u.pathname===`/api/games/${game.id}/automation`)return json(route,{adapterVerified:false});
 if(u.pathname==="/api/investigation") {queries.push(u);return json(route,{results:[{session,evidence:u.searchParams.get("kind")==="heatmap" ? {eventId:"p1",name:"pointer",timestamp:eventAt,replay:{captureId:capture.id,offsetSeconds:1,segment:1}} : {eventId:"e1",name:"visit",timestamp:start}}],hasMore:false,windowStart:start,windowEnd:end});}
 if(u.pathname===`/api/sessions/${session.id}`)return json(route,{events:[{id:"p1",name:"pointer",timestamp:eventAt,properties:{}}],capture,captures:[capture],coverage:{recordedSeconds:2,gaps:[],limitation:"Partial canvas recording."}});
 return route.continue();
});
try {
 await page.goto("http://127.0.0.1:3000/app",{waitUntil:"domcontentloaded"});
 await page.getByLabel("Filter by game").selectOption(game.id);
 await page.getByRole("navigation").getByRole("button",{name:"Player analytics"}).click();
 await page.getByRole("button",{name:/Viewed, no round start/}).click();
 await page.getByRole("region",{name:"Supporting sessions"}).getByRole("button").first().click();
 await page.getByText("No saved segment covers this event; showing the event only.").waitFor();
 assert.equal(queries[0].searchParams.get("dropoff"),"Viewed, no round start");
 assert.equal(queries[0].searchParams.get("end"),end);
 await page.getByRole("button",{name:"Close session"}).click();
 await page.getByLabel("Surface").selectOption("viewport");
 assert.equal(await page.getByLabel("Screen").inputValue(),"unknown");
 assert.equal(await page.getByLabel("Device").inputValue(),"mobile");
 assert.equal(await page.getByRole("button",{name:/Pointer bin 8, 9/}).count(),1);
 assert.equal(await page.getByRole("button",{name:/Pointer bin 3, 4/}).count(),0);
 await page.getByLabel("Surface").selectOption("game");
 await page.getByRole("button",{name:/Pointer bin 3, 4/}).click();
 const q=queries.at(-1)!; for(const [key,value] of Object.entries({kind:"heatmap",gameId:game.id,days:"7",end,surface:"game",screen:"battle",device:"desktop",bx:"2",by:"3"})) assert.equal(q.searchParams.get(key),value,key);
 await page.getByRole("region",{name:"Supporting sessions"}).getByRole("button").first().click();
 await page.getByText("The matching segment is selected; playback will seek when it loads.").waitFor();
 await page.waitForFunction(()=>{const v=document.querySelector<HTMLVideoElement>('video[aria-label="Player canvas capture"]');return v?.getAttribute("src")==="/investigation-video.webm" && Math.abs(v.currentTime-1)<.3;});
 console.log("PASS scoped heatmap dimensions, anchored drop-off/heatmap queries, event-only gap and covered segment seek");
} catch (error) { console.error("Visible state:", (await page.locator("body").innerText().catch(()=>"")).slice(0,2000)); console.error("Video state:", await page.locator('video[aria-label="Player canvas capture"]').evaluate((v:HTMLVideoElement)=>({src:v.getAttribute("src"), currentTime:v.currentTime,readyState:v.readyState,error:v.error?.message})).catch(()=>null)); throw error; }
finally {await browser.close();await rm(tempDir,{recursive:true,force:true});}
