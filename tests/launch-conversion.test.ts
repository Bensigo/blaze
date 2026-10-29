import { afterAll, beforeAll, expect, it } from 'vitest';
import { buildLaunchUrl } from '../src/components/launch-links';
import { ingest } from '../src/lib/telemetry';
import { sqlAnalytics } from '../src/lib/analytics-sql';
import { closeDatabase, put } from '../src/lib/db';
import type { Game } from '../src/lib/types';

const game: Game = {id:'launch-game',title:'Game',url:'https://game.example/play',description:'',image:'',genre:'',sdkKey:'sdk_launch_game_1234567890123456',origins:['https://game.example'],createdAt:new Date().toISOString(),dailyEnabled:false,competitors:[]};
const base=Math.floor((Date.now()-120000)/15000)*15000;
let n=0;
async function send(name:string, session:string, ms:number, properties:Record<string,unknown>={}, kind:'human'|'agent'='human') {
 const event={id:`launch-event-${++n}-abcdefgh`,name,sessionId:session,playerId:`player-${session}`,timestamp:new Date(base+ms).toISOString(),source:'social',campaign:'launch',properties};
 const request=new Request('https://studio.example/api/collect',{method:'POST',headers:{Origin:'https://game.example','Content-Type':'application/json'},body:JSON.stringify({sdkKey:game.sdkKey,events:[event]})});
 return (await ingest(request,kind==='agent'?{workspace:'launch-w',game,recordingId:'rec_launch_agent'}:undefined)).json();
}
beforeAll(async()=>{delete process.env.DATABASE_URL;delete process.env.VERCEL;process.env.LOCAL_DATABASE_PATH='memory://';await put('launch-w','game',game)});
afterAll(async()=>{await closeDatabase()});
it('builds encoded links without changing other parameters and rejects unsafe URLs',()=>{
 const url=new URL(buildLaunchUrl('https://game.example/play?mode=guest&utm_source=old#game','social & video','week 1'));
 expect(url.searchParams.get('mode')).toBe('guest');expect(url.searchParams.get('utm_source')).toBe('social & video');expect(url.searchParams.get('utm_campaign')).toBe('week 1');expect(url.hash).toBe('#game');
 expect(()=>buildLaunchUrl('javascript:alert(1)','x','launch')).toThrow();
});
it('reports tagged visit conversion, measured coverage and observed exits without counting unfinished as exit',async()=>{
 await send('visit','session-one',0);await send('round_start','session-one',10);await send('active_play','session-one',20,{duration:0});await send('active_play','session-one',100,{duration:15});expect(await send('active_play','session-one',200,{duration:15})).toEqual({accepted:0});await send('active_play','session-one',15001,{duration:15});
 await send('visit','session-two',30);await send('round_start','session-two',40);await send('exit','session-two',50);
 await send('visit','session-three',60);await send('round_start','session-three',70);await send('round_complete','session-three',80);
 await send('visit','session-four',90);await send('round_complete','session-four',100);await send('round_start','session-four',110);
 await send('round_start','session-no-visit',120);await send('round_complete','session-no-visit',130);
 await send('visit','session-agent',140,{},'agent');
 const result=await sqlAnalytics('launch-w',game.id,14,Date.now()+1000);
 expect(result.launch).toEqual({visits:4,exits:1,coverage:{sessions:5,visit:4,loaded:0,roundStart:5,firstAction:0,roundComplete:3,exit:1},conversionTotal:1,conversion:[{source:'social',campaign:'launch',visits:4,starts:4,meaningful:2,activeMeasured:1}]});
 expect(result.sessionsList.find(s=>s.id==='session-two')?.activePlaySeconds).toBeNull();
 expect((await sqlAnalytics('other',game.id,14,Date.now()+1000)).launch?.visits).toBe(0);
});
