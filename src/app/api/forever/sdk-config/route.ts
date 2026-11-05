import {list} from '@/lib/db';
import type {Game} from '@/lib/types';

/** Public origin-scoped install keys, already exposed in Forever's public config. Never returns workspace IDs or secrets. */
export async function GET(){
 const workspace=process.env.FOREVER_OBSERVABILITY_WORKSPACE_ID;
 if(!workspace)return Response.json({games:[]},{status:503,headers:{'Cache-Control':'no-store'}});
 const games=await list<Game>(workspace,'game');
 const keys=games.filter(g=>g.foreverCatalogue?.state==='listed'&&g.url===`https://playforever.app/games/${g.foreverCatalogue.slug}`&&g.origins.includes('https://playforever.app')&&/^[A-Za-z0-9_-]{20,100}$/.test(g.sdkKey)).map(g=>({slug:g.foreverCatalogue!.slug,sdkKey:g.sdkKey}));
 if(keys.length>100||new Set(keys.map(k=>k.slug)).size!==keys.length)return Response.json({games:[]},{status:503,headers:{'Cache-Control':'no-store'}});
 return Response.json({origin:'https://playforever.app',games:keys},{headers:{'Cache-Control':'public, max-age=30'}});
}
