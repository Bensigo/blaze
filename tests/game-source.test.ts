import {beforeAll,beforeEach,it,expect,vi} from 'vitest';
import type {Game} from '../src/lib/types';
const identity=vi.hoisted(()=>({workspace:'ws',authenticated:true}));
vi.mock('../src/lib/auth',async()=>{const actual=await vi.importActual<typeof import('../src/lib/auth')>('../src/lib/auth');return {...actual,requireIdentity:async()=>{if(!identity.authenticated)throw new actual.HttpError(401,'Sign in');return {workspace_id:identity.workspace};}};});
const manifest=vi.hoisted(()=>({read:vi.fn()}));vi.mock('../src/lib/game-manifest',()=>({readGameManifest:manifest.read}));
let db:typeof import('../src/lib/db'),source:typeof import('../src/lib/game-source'),studio:typeof import('../src/lib/content-studio'),scripts:typeof import('../src/lib/content-scripts');
const game:Game={id:'g',title:'Dog Chase',url:'https://old.example/games/dog',description:'',genre:'',image:'',sdkKey:'keep',origins:['https://old.example'],createdAt:'2026-10-30',dailyEnabled:true,competitors:[],networkPolicy:{resourceOrigins:['https://old.example'],webSocketOrigins:[],frameUrls:['https://old.example/dog.html']}};
const complete=()=>({status:'complete',source:{url:'https://london.example/games/dog/forever.json',sha256:'new',formatVersion:1,observedAt:'2026-10-30T12:00:00Z'},facts:{name:'Dog Chase',description:'A runner in Lagos.',genre:'Action',controls:{label:'Arrow keys'},howToPlay:['Jump and slide'],about:['Collect puff-puff'],faq:[]}});
beforeAll(async()=>{delete process.env.DATABASE_URL;delete process.env.VERCEL;process.env.LOCAL_DATABASE_PATH='memory://';db=await import('../src/lib/db');source=await import('../src/lib/game-source');studio=await import('../src/lib/content-studio');scripts=await import('../src/lib/content-scripts');});
beforeEach(async()=>{identity.workspace='ws';identity.authenticated=true;manifest.read.mockReset().mockResolvedValue(complete());await db.query('DELETE FROM records');await db.query('DELETE FROM jobs');await db.put('ws','game',game);await db.put('ws','game_profile',{id:'g',facts:[{key:'manifest_controls',value:'Old controls',evidence:{source:'Old manifest'}}]});});
it('owns edits before network IO, validates public URLs and rejects stale writes',async()=>{
 await expect(source.changeGameSource('other','g','https://london.example/games/dog',source.gameSourceVersion(game))).rejects.toThrow('not found');
 for(const url of ['http://example.com','https://user:pass@example.com','https://127.0.0.1/game','https://localhost/game','https://10.0.0.1/game','https://example.com:444/game','https://example.com/?token=x','https://example.com/#x'])await expect(source.changeGameSource('ws','g',url,source.gameSourceVersion(game))).rejects.toThrow();
 await expect(source.changeGameSource('ws','g','https://london.example/game','stale')).rejects.toThrow('another tab');expect(manifest.read).not.toHaveBeenCalled();
});
it('preserves source and approvals on a failed manifest and makes no provider request',async()=>{
 manifest.read.mockResolvedValue({status:'unavailable',detail:'Manifest inaccessible or redirecting'});await db.put('ws','video_production',{id:'p',gameId:'g',state:'approved'});
 await expect(source.changeGameSource('ws','g','https://london.example/game',source.gameSourceVersion(game))).rejects.toThrow('redirecting');expect(await db.get('ws','game','g')).toEqual(game);expect(await db.get('ws','video_production','p')).toMatchObject({state:'approved'});
});
it.each(['starting','running','importing','cancel_requested','needs_reconciliation'])('keeps monitored production intact while %s',async state=>{
 await db.put('ws','video_production',{id:'p',gameId:'g',state,sessionId:'keep-monitoring'});await expect(source.changeGameSource('ws','g','https://london.example/game',source.gameSourceVersion(game))).rejects.toThrow('active or uncertain');expect(await db.get('ws','game','g')).toEqual(game);expect(await db.get('ws','video_production','p')).toMatchObject({state,sessionId:'keep-monitoring'});
});
it('blocks claimed legacy work, deleted games and uncertain reviews',async()=>{
 await db.query("INSERT INTO jobs(id,workspace_id,kind,state,body) VALUES('j','ws','game_profile','claimed','{\"gameId\":\"g\"}')");await expect(source.changeGameSource('ws','g','https://london.example/game',source.gameSourceVersion(game))).rejects.toThrow('active or uncertain');await db.query('DELETE FROM jobs');
 await db.put('ws','script_review',{id:'r',gameId:'g',state:'needs_reconciliation'});await expect(source.changeGameSource('ws','g','https://london.example/game',source.gameSourceVersion(game))).rejects.toThrow('active or uncertain');await db.remove('ws','game','g');await expect(source.changeGameSource('ws','g','https://london.example/game',source.gameSourceVersion(game))).rejects.toThrow('not found');
});
it('freshens facts and revisions, consumes approvals, retains videos/history, pauses automation and makes old scores stale',async()=>{
 const idea=(await studio.prepareSourceIdeas('ws','g'))[0];const script=await scripts.saveContentScript('ws',idea.id,'Can you outrun the dogs? Show a real jump and its result.');
 const score={overall:79,hook:{score:21,explanation:'Fixture'},pacing:{score:23,explanation:'Fixture'},clarity:{score:22,explanation:'Fixture'},shareability:{score:13,explanation:'Fixture'},improvements:['Fixture suggestion']};
 await db.put('ws','script_review',{id:'review',scriptId:script.id,gameId:'g',scriptRevision:script.revision,sourceRevision:script.sourceRevision,approvedAt:'2026-10-30',state:'complete',score});
 expect((await studio.studioSnapshot('ws','g')).scripts?.[0].score?.overall).toBe(79);
 for(const [kind,id] of [['video_production','pending'],['script_review','unused'],['pilot_grant','grant']])await db.put('ws',kind,{id,gameId:'g',state:'approved'});
 await db.put('ws','video_production',{id:'finished',gameId:'g',state:'ready',videoUrl:'/owned/video'});await db.put('ws','game_automation',{id:'g',enabled:true});await db.query("INSERT INTO jobs(id,workspace_id,kind,state,body) VALUES('j','ws','recording','queued','{\"gameId\":\"g\"}')");
 const next=await source.changeGameSource('ws','g','https://london.example/games/dog',source.gameSourceVersion(game));
 expect(next).toMatchObject({sdkKey:'keep',origins:game.origins,url:'https://london.example/games/dog',dailyEnabled:false,networkPolicy:{resourceOrigins:[],webSocketOrigins:[],frameUrls:[]}});
 expect(next.sourceUrlRevision).toBeTruthy();expect(await db.get('ws','video_production','finished')).toMatchObject({state:'ready',videoUrl:'/owned/video'});expect(await db.list('ws','game_source_history')).toHaveLength(1);
 expect(await db.get('ws','video_production','pending')).toMatchObject({state:'failed'});expect(await db.get('ws','script_review','unused')).toMatchObject({state:'failed'});expect(await db.get('ws','pilot_grant','grant')).toMatchObject({state:'revoked'});expect(await db.get('ws','game_automation','g')).toMatchObject({enabled:false});
 const stale=await scripts.scriptState('ws',idea.id);expect(stale.sourceStale).toBe(true);expect(stale.review).toBeUndefined();expect(stale.staleReview?.score?.overall).toBe(79);const snapshot=await studio.studioSnapshot('ws','g');expect(snapshot.scripts?.[0]).toMatchObject({sourceStale:true,reviewState:'stale'});expect(snapshot.scripts?.[0].score).toBeUndefined();
 await expect(scripts.reviewedScript('ws',idea.id,(await studio.gameSources('ws','g')).revision)).rejects.toThrow('this script');
 expect((await studio.prepareSourceIdeas('ws','g'))[0].sourceRevision).not.toBe(idea.sourceRevision);
 await expect(source.changeGameSource('ws','g','https://london.example/games/dog',source.gameSourceVersion(game))).rejects.toThrow('another tab');expect(await source.changeGameSource('ws','g',next.url,source.gameSourceVersion(next))).toEqual(next);
});
it('blocks post-linked active work and cancels only queued approval paths',async()=>{
 await db.put('ws','post',{id:'post',gameId:'g',status:'scheduled',approvedHash:'old',text:'Keep copy'});
 await db.query("INSERT INTO jobs(id,workspace_id,kind,state,body) VALUES('publish','ws','publish','claimed','{\"postId\":\"post\"}')");
 await expect(source.changeGameSource('ws','g','https://london.example/game',source.gameSourceVersion(game))).rejects.toThrow('active or uncertain');await db.query('DELETE FROM jobs');
 await db.put('ws','post',{id:'post',gameId:'g',status:'uploading'});await expect(source.changeGameSource('ws','g','https://london.example/game',source.gameSourceVersion(game))).rejects.toThrow('active or uncertain');
 await db.put('ws','post',{id:'post',gameId:'g',status:'scheduled',approvedHash:'old',text:'Keep copy'});await db.query("INSERT INTO jobs(id,workspace_id,kind,state,body) VALUES('publish','ws','publish','queued','{\"postId\":\"post\"}')");
 await source.changeGameSource('ws','g','https://london.example/game',source.gameSourceVersion(game));expect(await db.get('ws','post','post')).toMatchObject({status:'draft',deliveryMethod:'manual',text:'Keep copy'});expect(await db.get('ws','post','post')).not.toHaveProperty('approvedHash');expect((await db.query<{state:string}>("SELECT state FROM jobs WHERE id='publish'"))[0].state).toBe('failed');
});

it('source API enforces sign-in, CSRF, workspace and bounded request validation before manifest access',async()=>{
 const {PATCH}=await import('../src/app/api/games/[id]/source/route');
 const send=(body:unknown,origin='https://blaze.example')=>PATCH(new Request('https://blaze.example/api/games/g/source',{method:'PATCH',headers:{origin,'Content-Type':'application/json'},body:JSON.stringify(body)}),{params:Promise.resolve({id:'g'})});
 const body={url:'https://london.example/game',expectedRevision:source.gameSourceVersion(game)};
 expect((await send(body,'https://evil.example')).status).toBe(403);identity.authenticated=false;expect((await send(body)).status).toBe(401);identity.authenticated=true;identity.workspace='other';expect((await send(body)).status).toBe(404);identity.workspace='ws';expect((await send({...body,unexpected:true})).status).toBe(400);expect((await send({url:'x'.repeat(5000),expectedRevision:'x'})).status).toBe(413);expect(manifest.read).not.toHaveBeenCalled();
 expect((await send(body)).status).toBe(200);expect(await db.get('ws','game','g')).toMatchObject({url:'https://london.example/game'});
});
