import {describe,it,expect} from 'vitest';
import type {VideoProduction} from '../src/lib/content-studio-contract';
import {latestFailedPilot} from '../src/lib/failed-pilot-context';
const job=(id:string,gameId:string,state:VideoProduction['state'],updatedAt:string,pilotGrantId?:string)=>({id,gameId,state,updatedAt,pilotGrantId}) as VideoProduction;
describe('failed commissioning context',()=>{
 it('keeps initial uncommissioned state distinct from a consumed failed attempt',()=>{expect(latestFailedPilot([],'selected',false)).toBeNull();const failed=job('consumed-attempt','selected','failed','2026-10-31','consumed-grant');expect(latestFailedPilot([failed],'selected',false)).toBe(failed);});
 it('does not present an old failed attempt as the current running pilot',()=>{expect(latestFailedPilot([job('old','selected','failed','2026-10-30','old-grant'),job('new','selected','running','2026-10-31','new-grant')],'selected',false)).toBeNull();});
 it('does not attribute another game or a normal failed job to commissioning',()=>{expect(latestFailedPilot([job('a','other','failed','2026-10-31','grant'),job('b','selected','failed','2026-10-31')],'selected',false)).toBeNull();});
 it('uses only the latest pilot and hides old failure after success or readiness',()=>{const old=job('a','selected','failed','2026-10-30','grant');expect(latestFailedPilot([old],'selected',false)?.id).toBe('a');expect(latestFailedPilot([old,job('b','selected','ready','2026-10-31','next')],'selected',false)).toBeNull();expect(latestFailedPilot([old],'selected',true)).toBeNull();});
});
