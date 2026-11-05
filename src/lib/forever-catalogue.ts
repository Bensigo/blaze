import {fetchPublic} from './integrations/safe-fetch';
import {gameMetadata} from './metadata';
import {list,id,transaction} from './db';
import {changeGameSource,gameSourceVersion} from './game-source';
import type {Game} from './types';

const origin='https://playforever.app';
export function foreverSlug(value:string){try{const u=new URL(value);const slug=['playforever.app','forever.africa','forever.138-68-247-33.sslip.io'].includes(u.hostname)?/^\/games\/([a-z0-9-]+)\/?$/.exec(u.pathname)?.[1]:undefined;return slug==='keke-smash'?'tuk-tuk-rush':slug;}catch{return;}}
export function catalogueUrls(body:string){
 const urls=[...new Set(body.match(/https:\/\/playforever\.app\/games\/[a-z0-9-]+\/forever\.json/g)??[])].map(url=>url.replace(/\/forever\.json$/,''));
 if(!urls.length||urls.length>100)throw Error('Forever did not publish a valid catalogue. No games were changed.');
 return urls;
}
/** Fetch and validate all current manifests before touching saved records. No AI, recording or publication is started. */
export async function syncForeverCatalogue(workspace:string){
 const source=await fetchPublic(origin+'/llms.txt',0);
 if(source.status!==200||source.url!==origin+'/llms.txt')throw Error('Forever catalogue is unavailable. No games were changed.');
 const urls=catalogueUrls(source.body),metadata:Awaited<ReturnType<typeof gameMetadata>>[]=[];
 for(let offset=0;offset<urls.length;offset+=4)metadata.push(...await Promise.all(urls.slice(offset,offset+4).map(url=>gameMetadata(url,origin))));
 const before=await list<Game>(workspace,'game');
 for(const m of metadata){const matches=before.filter(g=>foreverSlug(g.url)===foreverSlug(m.url));if(matches.length>1)throw Error('Duplicate Forever game records need review before syncing. No games were changed.');}
 // Reuse the existing guarded source migration: claimed/uncertain work blocks changes and old approvals are consumed.
 return transaction(async sql=>{
  await sql('SELECT pg_advisory_xact_lock(hashtext($1))',[`forever-catalogue:${workspace}`]);
  const records=await sql<{body:Game}>("SELECT body FROM records WHERE workspace_id=$1 AND kind='game' FOR UPDATE",[workspace]);
  for(const m of metadata){const prior=records.find(r=>foreverSlug(r.body.url)===foreverSlug(m.url))?.body;if(prior&&prior.url!==m.url){const next=await changeGameSource(workspace,prior.id,m.url,gameSourceVersion(prior),sql);const row=records.find(r=>r.body.id===prior.id);if(row)row.body=next;}}
  const games=records.map(r=>r.body),at=new Date().toISOString(),current=new Set(metadata.map(m=>foreverSlug(m.url)));
  let created=0,updated=0,retired=0;
  for(const m of metadata){
   const matches=games.filter(g=>foreverSlug(g.url)===foreverSlug(m.url));if(matches.length>1)throw Error('Catalogue changed during sync. Reload and review duplicates.');
   const prior=matches[0];if(prior&&prior.url!==m.url)throw Error('A source URL changed during sync. Retry after reviewing it.');
   const game={...(prior??{id:id('game'),sdkKey:id('sdk'),createdAt:at,dailyEnabled:false,competitors:[]}),...m,...(prior?.metadataStatus?.includes('review required')?{metadataStatus:prior.metadataStatus}:{}),origins:[...new Set([...(prior?.origins??[]),origin])],foreverCatalogue:{state:'listed',slug:foreverSlug(m.url),checkedAt:at}};
   await sql("INSERT INTO records(workspace_id,kind,id,body) VALUES($1,'game',$2,$3::jsonb) ON CONFLICT(workspace_id,kind,id) DO UPDATE SET body=excluded.body,updated_at=now()",[workspace,game.id,JSON.stringify(game)]);
   prior?updated++:created++;
  }
  for(const game of games){const slug=foreverSlug(game.url);if(!slug||current.has(slug))continue;
   await sql("UPDATE records SET body=body || $3::jsonb,updated_at=now() WHERE workspace_id=$1 AND kind='game' AND id=$2",[workspace,game.id,JSON.stringify({dailyEnabled:false,origins:[...new Set([...game.origins,origin])],foreverCatalogue:{state:'retired',slug,checkedAt:at}})]);retired++;
  }
  return {listed:metadata.length,created,updated,retired,checkedAt:at};
 });
}
