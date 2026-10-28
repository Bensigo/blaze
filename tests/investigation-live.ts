/** Read-only local query against the earlier controlled fixture session. */
import assert from "node:assert/strict";
const base="http://127.0.0.1:3000", gameId="game_d38d89fc5d5d4abfa24917233123e085";
const auth=await fetch(`${base}/api/auth/dev`,{method:"POST",headers:{Origin:base}}); assert.equal(auth.status,200);
const cookie=auth.headers.get("set-cookie")!.split(";")[0];
const snapshot=await fetch(`${base}/api/workspace?${new URLSearchParams({gameId,days:"7"})}`,{headers:{Cookie:cookie}});assert.equal(snapshot.status,200);
const data=await snapshot.json(); const point=data.analytics.heatmap.find((p:{gameId:string})=>p.gameId===gameId);assert.ok(point,"fixture pointer bin exists");
const params=new URLSearchParams({kind:"heatmap",gameId,days:"7",end:data.analytics.windowEnd,surface:point.surface,screen:point.screen,device:point.device,bx:String(point.bx),by:String(point.by)});
const response=await fetch(`${base}/api/investigation?${params}`,{headers:{Cookie:cookie}});assert.equal(response.status,200);
const result=await response.json();assert.ok(result.results.length>0,"fixture session matches");
for(const row of result.results){assert.equal(row.session.gameId,gameId);assert.equal(row.session.kind,"human");assert.equal(row.evidence.name,"pointer");}
console.log(JSON.stringify({result:"pass",scope:"controlled local fixture; not human play",gameId,surface:point.surface,screen:point.screen,device:point.device,bin:[point.bx,point.by],matches:result.results.length,hasMore:result.hasMore,windowStart:result.windowStart,windowEnd:result.windowEnd}));
