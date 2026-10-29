import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as db from '../src/lib/db';
import { sqlMostPlayedGames } from '../src/lib/analytics-sql';
import { summarizeMostPlayed, type EventRow } from '../src/lib/analytics';
import type { Game } from '../src/lib/types';
const now=Date.parse('2026-10-28T12:00:00Z');
const game=(id:string,url=`https://example.test/${id}`)=>({id,title:id,url,description:'',image:'',genre:'',sdkKey:'',origins:[],createdAt:new Date(now).toISOString(),dailyEnabled:false,competitors:[]} satisfies Game);
const games=[game('a'),game('b'),game('c'),game('fixture','https://app.example/fixture/index.html')];
const events:EventRow[]=[]; let serial=0;
async function add(gameId:string,session:string,player:string,name:string,offset:number,options:{kind?:'human'|'agent';properties?:Record<string,unknown>;workspace?:string;received?:number}={}) {
 const e:EventRow={id:`e${String(++serial).padStart(3,'0')}`,game_id:gameId,session_id:session,player_id:player,name,kind:options.kind||'human',occurred_at:new Date(now+offset).toISOString(),country:'',device:'',source:'',campaign:'',page:'',properties:options.properties||{},received_at:new Date(options.received??now).toISOString()};
 await db.query(`INSERT INTO events(id,workspace_id,game_id,session_id,player_id,kind,name,occurred_at,received_at,country,device,source,campaign,page,properties) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'','','','','',$10::jsonb)`,[e.id,options.workspace||'w',gameId,session,player,e.kind,name,e.occurred_at,e.received_at,JSON.stringify(e.properties)]);
 if (!options.workspace) events.push(e);
}
beforeAll(async()=>{
 delete process.env.DATABASE_URL; delete process.env.VERCEL; process.env.LOCAL_DATABASE_PATH='memory://';
 for(const g of games) await db.put('w','game',g);
 await db.put('other','game',game('private'));
 await add('a','s1','same','round_start',-6000); await add('a','s1','same','active_play',-5000,{properties:{duration:9}}); await add('a','s1','same','round_start',-4000);
 await add('a','s2','same','round_start',-3000); await add('b','s3','another','round_start',-2000);
 await add('c','c1','third','round_start',-5000); await add('c','c2','third','round_start',-4000);
 await add('b','only-visit','not-playing','visit',-1000);
 await add('b','marked','test-id','round_start',-2000); await add('b','marked','test-id','exit',-1000,{properties:{isTest:true}});
 await add('b','agent','bot','round_start',-1000,{kind:'agent'});
 await add('fixture','f','fixture-player','round_start',-1000);
 await add('private','foreign','foreign','round_start',-1000,{workspace:'other'});
 await add('a','old','old','round_start',-15*86400000); await add('a','future','future','round_start',1000);
 await add('a','late','late','round_start',-1000,{received:now+1000});
});
afterAll(async()=>db.closeDatabase());
describe('most played',()=>{
 it('matches SQL and JS for distinct browsers, start counts, measurement coverage and exclusions',async()=>{
   const sql=await sqlMostPlayedGames('w',undefined,14,now), js=summarizeMostPlayed(events,games,14,now);
   expect(sql).toEqual(js); expect(sql).toEqual([
     {gameId:'a',browserIds:1,playedSessions:2,roundStarts:3,activeSeconds:9,measuredSessions:1},
     {gameId:'c',browserIds:1,playedSessions:2,roundStarts:2,activeSeconds:null,measuredSessions:0},
     {gameId:'b',browserIds:1,playedSessions:1,roundStarts:1,activeSeconds:null,measuredSessions:0},
   ]);
 });
 it('scopes by game, time window and workspace',async()=>{
   expect(await sqlMostPlayedGames('w','b',14,now)).toEqual([expect.objectContaining({gameId:'b',browserIds:1})]);
   expect(await sqlMostPlayedGames('w','a',1,now)).toEqual([expect.objectContaining({gameId:'a',browserIds:1})]);
   expect(await sqlMostPlayedGames('other',undefined,14,now)).toEqual([expect.objectContaining({gameId:'private',browserIds:1})]);
   expect(await sqlMostPlayedGames('w','private',14,now)).toEqual([]);
 });
});
