/** Controlled segment seek test using a local fixture video; no provider or user footage. */
import { chromium, type Route } from "playwright";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { buildDemo } from "../src/lib/demo";
const video=await readFile("/Users/macbook/Documents/Codex/2026-10-28/web-game-marketing-build/outputs/human-capture-local-fixture.webm");
const browser=await chromium.launch({headless:true}); const page=await browser.newPage();
const demo=buildDemo(); const game=demo.games[0]; const session={...demo.analytics.sessionsList[0],id:"segment-test",gameId:game.id,activePlaySeconds:null};
const workspace={...demo,demo:false,user:{name:"Test",email:"test@example.test"},games:[game],analytics:{...demo.analytics,sessionsList:[session],sessionPage:{limit:100,total:1}}};
const base={gameId:game.id,sessionId:session.id,status:"ready",createdAt:"2026-10-27T10:00:00Z",expiresAt:"2027-10-27T10:00:00Z",durationSeconds:4,width:320,height:180};
const captures=[{...base,id:"c1",segment:0,recordedAt:"2026-10-27T10:00:00Z",videoUrl:"/video-1.webm"},{...base,id:"c2",segment:1,recordedAt:"2026-10-27T10:00:40Z",videoUrl:"/video-2.webm"}];
const json=(r:Route,x:unknown)=>r.fulfill({status:200,contentType:"application/json",body:JSON.stringify(x)});
await page.route("**/*",async route=>{const path=new URL(route.request().url()).pathname;
 if(path.startsWith("/video-")) return route.fulfill({status:200,contentType:"video/webm",body:video});
 if(path==="/api/auth/config") return json(route,{googleConfigured:true});
 if(path==="/api/workspace") return json(route,workspace);
 if(path===`/api/sessions/${session.id}`) return json(route,{events:[{id:"e1",name:"round_start",timestamp:"2026-10-27T10:00:41Z",properties:{}}],capture:captures[0],captures,coverage:{recordedSeconds:8,gaps:[{startAt:"2026-10-27T10:00:04Z",endAt:"2026-10-27T10:00:40Z",reason:"between_segments"}],limitation:"Partial canvas capture."}});
 return route.continue();});
try {await page.goto("http://127.0.0.1:3000/app",{waitUntil:"domcontentloaded"});
 await page.getByRole("navigation").getByRole("button",{name:"Sessions",exact:true}).click();
 await page.getByRole("row").filter({hasText:"segment-"}).click();
 await page.getByText("Unrecorded gaps").waitFor();
 await page.getByRole("button",{name:/Seek to 0:01 in segment 2/}).click();
 await page.waitForFunction(()=>{const v=document.querySelector<HTMLVideoElement>('video[aria-label="Player canvas capture"]'); return v?.getAttribute("src")==="/video-2.webm" && Math.abs(v.currentTime-1)<0.25;});
 assert.match(await page.getByLabel("Capture segment").inputValue(),/c2/);
 if (process.env.UI_SCREENSHOTS) await page.screenshot({path:"/Users/macbook/Documents/Codex/2026-10-28/web-game-marketing-build/outputs/dashboard-segment-seek.png",fullPage:true});
 console.log("PASS segment selection, coverage gaps, and seek to the second segment's actual start offset");
} finally {await browser.close();}
