/** Controlled UI acceptance. No provider authorization or publication occurs. */
import { chromium, type Route } from "playwright";
import assert from "node:assert/strict";
import { buildDemo } from "../src/lib/demo";
const browser = await chromium.launch({headless:true});
const page = await browser.newPage({viewport:{width:1440,height:900}});
const demo = buildDemo();
const game = {...demo.games[0], id:"launch-game", title:"Launch game", url:"https://game.example/index.html", image:"https://game.example/cover.svg", networkPolicy:{resourceOrigins:[],webSocketOrigins:[],frameUrls:["https://game.example/play/index.html"]}};
const post = {id:"post-1",gameId:game.id,channel:"x",text:"A draft",accountId:"acct-1",status:"review",createdAt:new Date().toISOString(),campaignId:"campaign-1"};
const manualPost = {...post, id:"manual-1", text:"Manual caption", deliveryMethod:"manual", accountId:"@owner", status:"approved", clipId:"clip-1", scheduledAt:new Date().toISOString(), timeZone:"UTC", recommendation:{confidence:"low",reason:"Format-based starting point, not an audience ranking.",time:"18:00 UTC is an arbitrary editable starting time, not an audience prediction."}};
const manualMissing = {...manualPost, id:"manual-2", text:"Needs schedule", status:"review", scheduledAt:undefined, timeZone:undefined};
const workspace = {...demo,demo:false,user:{name:"Test",email:"test@example.test"},games:[game],recordings:[{id:"fixture-1",gameId:game.id,title:"Fixture",mode:"fixture",status:"ready",createdAt:new Date().toISOString()}],runs:[],posts:[post,manualPost,manualMissing],connections:[{id:"x-1",provider:"x",label:"Test account",accountName:"Verified Name",accountId:"acct-1",connected:true,authMethod:"oauth",checkedAt:new Date().toISOString()}],system:{...demo.system,worker:false,lastWorkerAt:"2026-10-27T08:00:00Z",social:[{provider:"x",configured:false,setup:"Set X app credentials",callbackUrl:"https://example.test/callback"}]}};
let profile = {gameId:game.id,status:"partial",lastRefresh:"2026-10-27T08:00:00Z",facts:[{key:"title",label:"Title",value:"Launch game",evidence:{source:"Game page",url:"https://example.test/game",observedAt:"2026-10-27T08:00:00Z"}}],overrides:{audience:"Fans of puzzles"},prerequisites:["Connect Jev"]};
const requests: {path:string,body:unknown}[]=[];
const json=(route:Route,body:unknown,status=200)=>route.fulfill({status,contentType:"application/json",body:JSON.stringify(body)});
await page.route("**/api/**",async route=>{
 const req=route.request(),url=new URL(req.url());
 if(url.pathname==="/api/auth/config") return json(route,{googleConfigured:true});
 if(url.pathname==="/api/workspace") return json(route,workspace);
 if(url.pathname===`/api/games/${game.id}/automation`) return json(route,{enabled:true,intervalHours:24,ready:false,reasons:["Need a Jev recording"],draftReady:false,draftReasons:["Need Anthropic"],adapterVerified:false,lastQueuedAt:null,activeRecordingId:null,nextDueAt:null});
 if(url.pathname===`/api/games/${game.id}/profile`) {
  if(req.method()==="PATCH") {const body=req.postDataJSON(); requests.push({path:url.pathname,body}); profile={...profile,overrides:body.overrides};}
  if(req.method()==="POST") {requests.push({path:url.pathname,body:req.postDataJSON()}); profile={...profile,status:"queued"};}
  return json(route,profile);
 }
 if(url.pathname === "/api/posts/manual-1/manual-export") { requests.push({path:url.pathname,body:{}}); return json(route,{caption:"Manual caption",channel:"x",destination:"@owner",destinationVerified:false,scheduledAt:null,timeZone:"UTC",downloadUrl:"/api/posts/manual-1/manual-export/download",exportedAt:new Date().toISOString(),recommendation:{platform:"X",platformReason:"Starting point",time:"Choose a time",confidence:"low",source:"No performance data"}}); }
 if(url.pathname.startsWith("/api/social/")) {requests.push({path:url.pathname,body:req.postDataJSON()}); return json(route,{error:"Set X app credentials"},400);}
 if(url.pathname==="/api/actions") {requests.push({path:url.pathname,body:req.postDataJSON()}); return json(route,{});}
 return route.continue();
});
try {
 await page.goto("http://127.0.0.1:3000/app",{waitUntil:"domcontentloaded"});
 await page.getByText("Recording readiness").waitFor();
 assert.equal(await page.getByLabel("Filter by date").inputValue(),"7");
 await page.getByLabel("Filter by date").selectOption("14");
 assert.equal(await page.getByLabel("Filter by date").inputValue(),"14");
 await page.getByLabel("Filter by game").selectOption(game.id);
 await page.getByText("Requires a successful Jev recording with model decisions and footage. Fixtures do not verify Jev.").waitFor();
 assert.equal(await page.getByText("Fixture · Ready").count(),1);
 await page.getByRole("button",{name:"Connections",exact:true}).click();
 await page.getByText("OAuth app setup required. Connect to see setup instructions.").first().waitFor();
 await page.locator(".connection-row").filter({hasText:"Posting and public research"}).getByRole("button",{name:"Add account"}).click();
 await page.getByRole("alert").getByText("Set X app credentials").waitFor();
 assert.deepEqual(requests.at(-1),{path:"/api/social/x/connect",body:{}});
 await page.locator(".connection-row").filter({hasText:"Posting and public research"}).getByRole("button",{name:"Reconnect"}).click();
 assert.deepEqual(requests.at(-1),{path:"/api/social/x/connect",body:{connectionId:"x-1"}});
 await page.getByRole("button",{name:"Add connection"}).click();
 await page.getByLabel("Provider").selectOption("x");
 await page.getByRole("button",{name:"Advanced: use a manual token"}).click();
 await page.getByLabel("Connection label").fill("Manual test");
 await page.getByLabel("Token or API key").fill("test-only");
 await page.getByRole("button",{name:"Save connection"}).click();
 assert.equal((requests.find(r=>r.path==="/api/actions")?.body as {advanced:boolean}).advanced,true);
 await page.getByRole("navigation").getByRole("button",{name:"Games",exact:true}).click();
 await page.getByText("Observed evidence").waitFor();
 await page.locator(".game-row").getByRole("button",{name:"Edit",exact:true}).click();
 assert.equal(await page.getByLabel("Reviewed game frame URLs").inputValue(),"https://game.example/play/index.html");
 await Promise.all([page.waitForResponse(r => new URL(r.url()).pathname === "/api/actions" && r.request().method() === "POST"), page.getByRole("button",{name:"Save changes"}).click()]);
 const gameSave=requests.find(r=>r.path==="/api/actions" && (r.body as {action:string}).action==="update_game");
 assert.deepEqual((gameSave?.body as {networkPolicy:{frameUrls:string[]}}).networkPolicy.frameUrls,["https://game.example/play/index.html"]);
 await page.getByText("Connect Jev").waitFor();
 await page.getByRole("button",{name:"Edit owner details"}).click();
 await page.getByLabel("Audience hypothesis").fill("People testing puzzles");
 await page.getByRole("button",{name:"Save owner details"}).click();
 await page.getByText("Owner details saved.").waitFor();
 assert.equal((requests.find(r=>r.path.endsWith("/profile"))?.body as {overrides:{audience:string}}).overrides.audience,"People testing puzzles");
 await page.getByRole("navigation").getByRole("button",{name:"Content studio"}).click();
 await page.locator(".post-row").filter({hasText:"A draft"}).getByRole("button",{name:"Review"}).click();
 await page.getByText("Verified Name · ID: acct-1").waitFor();
 if (process.env.UI_SCREENSHOTS) await page.screenshot({path:"/Users/macbook/Documents/Codex/2026-10-28/web-game-marketing-build/outputs/dashboard-post-review.png",fullPage:true});
 await page.getByRole("dialog").getByRole("button",{name:"Close"}).click();
 await page.locator(".post-row").filter({hasText:"Manual caption"}).getByRole("button",{name:"Review"}).click();
 await page.getByText("@owner · Unverified, entered by you").waitFor();
 await page.getByRole("dialog").getByText("Format-based starting point, not an audience ranking.").waitFor();
 assert.equal(await page.getByRole("button",{name:"Publish now"}).count(),0);
 await page.getByRole("button",{name:"Prepare approved export"}).click();
 await page.getByText("Preparing an export does not publish it.",{exact:false}).waitFor();
 assert.equal(requests.at(-1)?.path,"/api/posts/manual-1/manual-export");
 await page.getByRole("dialog").getByRole("button",{name:"Close"}).click();
 await page.locator(".post-row").filter({hasText:"Needs schedule"}).getByRole("button",{name:"Review"}).click();
 await page.getByText("Set a planned time and time zone in Edit post before approval.").waitFor();
 assert.ok(await page.getByRole("button",{name:"Approve post"}).isDisabled());
 await page.getByRole("dialog").getByRole("button",{name:"Close"}).click();
 await page.getByRole("navigation").getByRole("button",{name:"Calendar"}).click();
 await page.getByRole("button",{name:"List",exact:true}).click();
 await page.getByText("18:00 UTC is an arbitrary editable starting time, not an audience prediction.").waitFor();
 await page.getByRole("navigation").getByRole("button",{name:"Content studio"}).click();
 await page.getByRole("button",{name:"New post"}).click();
 await page.getByLabel("Delivery method").selectOption("manual");
 await page.getByLabel("Destination handle or account").fill("@creator");
 assert.equal(await page.getByLabel(/Planned time/).getAttribute("required"),"");
 assert.equal(await page.getByLabel("Account",{exact:true}).count(),0);
 console.log("PASS controlled fixture isolation, OAuth connect/reconnect error, advanced manual token, profile evidence/owner edit, and verified review destination, manual export and unverified destination, seven-day default, and preserved frame URL");
} finally {await browser.close();}
