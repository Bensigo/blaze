import type {VideoProduction} from './content-studio-contract';
// A failed commissioning attempt is context, never permission for another run.
export function latestFailedPilot(productions:VideoProduction[],gameId:string,ready:boolean){
 if(ready)return null;
 const latest=productions.filter(p=>p.gameId===gameId&&p.pilotGrantId).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt))[0];
 return latest?.state==='failed'?latest:null;
}
