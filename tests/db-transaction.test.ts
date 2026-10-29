import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as db from '../src/lib/db';
beforeAll(async () => { delete process.env.DATABASE_URL; delete process.env.VERCEL; process.env.LOCAL_DATABASE_PATH = 'memory://'; });
afterAll(async () => { await db.closeDatabase(); });
describe('database transaction', () => {
  it('commits all writes and returns typed query results', async () => {
    const result = await db.transaction(async query => {
      await query("INSERT INTO records(workspace_id,kind,id,body) VALUES('ws','tx','one','{}')");
      await query("INSERT INTO records(workspace_id,kind,id,body) VALUES('ws','tx','two','{}')");
      return query<{id:string}>("SELECT id FROM records WHERE workspace_id='ws' AND kind='tx' ORDER BY id");
    });
    expect(result.map(row => row.id)).toEqual(['one','two']);
    expect((await db.query("SELECT id FROM records WHERE workspace_id='ws' AND kind='tx'")).length).toBe(2);
  }, 30000);
  it('rolls back earlier writes when a later statement fails', async () => {
    await expect(db.transaction(async query => {
      await query("INSERT INTO records(workspace_id,kind,id,body) VALUES('ws','rollback','one','{}')");
      await query("INSERT INTO records(workspace_id,kind,id,body) VALUES('ws','rollback','one','{}')");
    })).rejects.toThrow();
    expect(await db.query("SELECT id FROM records WHERE workspace_id='ws' AND kind='rollback'")).toEqual([]);
  });
});
