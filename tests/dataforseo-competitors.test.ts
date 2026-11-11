import {describe,it,expect,vi} from 'vitest';
import {collectCompetitorEvidence} from '../src/lib/integrations/dataforseo-competitors';
import type {CompetitorTarget} from '../src/lib/competitor-types';
const targets:CompetitorTarget[] = [
 {id:'a',title:'A',platform:'web',url:'https://example.com/games/a'},
 {id:'b',title:'B',platform:'web',url:'https://example.com/games/b'},
 {id:'i',title:'I',platform:'ios',url:'https://apps.apple.com/us/app/name/id123',appId:'123'},
 {id:'g',title:'G',platform:'android',url:'https://play.google.com/store/apps/details?id=com.game',appId:'com.game'}
];
const market={keyword:'ball game',country:'US',device:'mobile' as const};
const credentials={login:'private',password:'secret'};
const ok=(items:unknown[])=>new Response(JSON.stringify({status_code:20000,tasks:[{status_code:20000,result:[{items}]}]}));
const metrics={pos_1:1,pos_2_3:2,pos_4_10:3,count:10,search_volume:320};
describe('DataForSEO competitor evidence',()=>{
 it('keeps page paths distinct and marks modeled values separately',async()=>{
  const f=vi.fn(async(input:string|URL|Request, _options?: RequestInit)=>{const url=String(input);
   if(url.includes('organic/live'))return ok([{type:'paid',url:targets[0].url,rank_group:1},{type:'organic',url:targets[0].url,rank_group:3,rank_absolute:7}]);
   if(url.includes('bulk_traffic'))return ok([{target:targets[0].url,metrics:{organic:{etv:42.5}}},{target:'example.com',metrics:{organic:{etv:999}}}]);
   if(url.includes('/apple/'))return ok([{app_id:'123',metrics:{app_store_search_organic:metrics}}]);
   return ok([{app_id:'com.game',metrics:{google_play_search_organic:metrics}}]);
  });
  const result=await collectCompetitorEvidence(targets,market,credentials,f as typeof fetch);
  expect(result.web.a).toEqual({rank:3,estimatedVisits:42.5}); expect(result.web.b).toEqual({rank:null,estimatedVisits:null});
  expect(result.stores.i).toEqual({rankedKeywords:10,topTenKeywords:6,estimatedSearchVolume:320}); expect(result.stores.g).toEqual(result.stores.i);
  expect(Object.values(result.sources)).toEqual(['ok','ok','ok','ok']);
  for(const [url,options] of f.mock.calls) {expect(String(url)).toMatch(/^https:\/\/api\.dataforseo\.com\/v3\//); expect(options?.redirect).toBe('error');}
 });
 it('distinguishes provider failures, skipped searches, and invalid data',async()=>{
  const f=vi.fn(async(input:string|URL|Request)=>String(input).includes('bulk_traffic') ? new Response('{}',{status:503}) : ok([{app_id:'123',metrics:{app_store_search_organic:{...metrics,count:1}}}]));
  const result=await collectCompetitorEvidence(targets,{...market,keyword:''},credentials,f as typeof fetch);
  expect(result.sources.search).toBe('skipped');expect(result.sources.traffic).toBe('unavailable');expect(result.stores.i).toBeUndefined();
  expect(result.web.a.estimatedVisits).toBeNull();
 });
 it('treats malformed task results as unavailable',async()=>{
  const f=vi.fn(async()=>new Response(JSON.stringify({status_code:20000,tasks:[{status_code:40100,result:[]}]})));
  const result=await collectCompetitorEvidence(targets,market,credentials,f as typeof fetch);
  expect(Object.values(result.sources)).toEqual(['unavailable','unavailable','unavailable','unavailable']);
 });
});
