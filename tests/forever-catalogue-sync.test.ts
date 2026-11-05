import {beforeAll,afterAll,beforeEach,it,expect,vi} from 'vitest';
const transport=vi.hoisted(()=>({fetch:vi.fn(),metadata:vi.fn(),manifest:vi.fn()}));
vi.mock('../src/lib/integrations/safe-fetch',()=>({fetchPublic:transport.fetch}));
vi.mock('../src/lib/metadata',()=>({gameMetadata:transport.metadata}));
vi.mock('../src/lib/game-manifest',()=>({readGameManifest:transport.manifest}));
import {syncForeverCatalogue} from '../src/lib/forever-catalogue';
import * as db from '../src/lib/db';
const root='https://playforever.app',urls=['runners','bible-learning'];
const game=(id:string,slug:string,url=root+'/games/'+slug)=>({id,title:slug,url,description:'old',genre:'Action',image:'',sdkKey:'sdk_keep_'+id,origins:[new URL(url).origin],createdAt:'2026-11-01',dailyEnabled:false,competitors:[]});
beforeAll(()=>{delete process.env.DATABASE_URL;delete process.env.VERCEL;process.env.LOCAL_DATABASE_PATH='memory://';});
beforeEach(async()=>{
 await db.query('DELETE FROM records');await db.query('DELETE FROM jobs');
 transport.fetch.mockResolvedValue({status:200,url:root+'/llms.txt',body:urls.map(s=>`${root}/games/${s}/forever.json`).join('\n')});
 transport.metadata.mockImplementation(async(url:string)=>({url,title:url.split('/').at(-1),description:'current',genre:'Action',image:root+'/cover.webp',metadataStatus:'Forever manifest',manifestSource:{url:url+'/forever.json',formatVersion:1,observedAt:new Date().toISOString(),sha256:'a'.repeat(64)}}));
 transport.manifest.mockImplementation(async(url:string)=>({status:'complete',source:{url:url+'/forever.json',formatVersion:1,observedAt:new Date().toISOString(),sha256:'a'.repeat(64)},facts:{name:'Bible',description:'Current',genre:'Trivia',controls:{label:'Tap'},howToPlay:['Read'],about:['Read'],faq:[]}}));
});
afterAll(async()=>db.closeDatabase());
it('retains keys, historical records and other workspaces; repeating does not duplicate games',async()=>{
 await db.put('owner','game',game('r','runners'));await db.put('owner','game',game('old','ludo'));await db.put('other','game',game('r','runners'));
 const first=await syncForeverCatalogue('owner');expect(first).toMatchObject({listed:2,created:1,updated:1,retired:1});
 expect(await db.get('owner','game','r')).toMatchObject({sdkKey:'sdk_keep_r',title:'runners',foreverCatalogue:{state:'listed'}});
 expect(await db.get('owner','game','old')).toMatchObject({sdkKey:'sdk_keep_old',foreverCatalogue:{state:'retired'}});
 expect(await db.get('other','game','r')).not.toHaveProperty('foreverCatalogue');
 expect(await syncForeverCatalogue('owner')).toMatchObject({created:0,updated:2,retired:1});expect(await db.list('owner','game')).toHaveLength(3);
});
it('rolls back every source move if another game has active work',async()=>{
 await db.put('owner','game',game('r','runners','https://forever.africa/games/runners'));
 await db.put('owner','game',game('b','bible-learning','https://forever.africa/games/bible-learning'));
 await db.put('owner','video_production',{id:'busy',gameId:'b',state:'running'});
 await expect(syncForeverCatalogue('owner')).rejects.toThrow('active or uncertain');
 expect((await db.get<any>('owner','game','r')).url).toContain('forever.africa');expect(await db.list('owner','game_source_history')).toHaveLength(0);
});
it('does not change any saved record if one published manifest cannot validate',async()=>{
 await db.put('owner','game',game('r','runners'));transport.metadata.mockRejectedValueOnce(Error('invalid manifest'));
 await expect(syncForeverCatalogue('owner')).rejects.toThrow('invalid manifest');expect(await db.get('owner','game','r')).toEqual(game('r','runners'));
});
