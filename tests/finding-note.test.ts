import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import * as db from '../src/lib/db';
import { saveFindingNote, setFindingDecision } from '../src/lib/finding-decisions';
const stamp=new Date('2026-10-29T12:00:00Z');
beforeAll(async()=>{delete process.env.DATABASE_URL;delete process.env.VERCEL;process.env.LOCAL_DATABASE_PATH='memory://';});
beforeEach(async()=>{await db.query("DELETE FROM records WHERE kind='finding'");});
afterAll(async()=>{await db.closeDatabase();});
describe('note-only action',()=>{
  it.each(['open','in_progress','resolved','deferred','dismissed'])('preserves %s and unrelated fields including past deferrals',async status=>{
    const before={id:'f',gameId:'g',status,deferredUntil:'2026-01-01T00:00:00.000Z',resolvedAt:'2026-02-01T00:00:00.000Z',decisionNote:'old',evidence:[{label:'proof'}],research:'result',measurementId:'m'};
    await db.put('w','finding',before);
    const saved=await saveFindingNote('w','f','  new note  ',stamp,'g');
    expect(saved).toEqual({...before,decisionNote:'new note',updatedAt:stamp.toISOString()});
    const cleared=await saveFindingNote('w','f','  ',stamp,'g');
    expect(cleared).not.toHaveProperty('decisionNote');
    expect(cleared).toMatchObject({status,deferredUntil:before.deferredUntil,resolvedAt:before.resolvedAt,evidence:before.evidence,measurementId:'m'});
  },30000);
  it('isolates workspace and optional game identity',async()=>{
    await db.put('w','finding',{id:'f',gameId:'g',status:'open'});
    await expect(saveFindingNote('other','f','x')).rejects.toThrow();
    await expect(saveFindingNote('w','f','x',stamp,'other')).rejects.toThrow();
    expect(await db.get('w','finding','f')).toEqual({id:'f',gameId:'g',status:'open'});
  });
  it('keeps a concurrent status move and note update',async()=>{
    await db.put('w','finding',{id:'f',gameId:'g',status:'open',evidence:['proof']});
    await Promise.all([saveFindingNote('w','f','new',stamp),setFindingDecision('w','f',{status:'in_progress'},stamp)]);
    expect(await db.get('w','finding','f')).toMatchObject({status:'in_progress',decisionNote:'new',evidence:['proof']});
  });
});
