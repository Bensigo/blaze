import { afterAll, beforeAll, expect, it } from 'vitest';
import { closeDatabase, put, query } from '../src/lib/db';
import { mintSyntheticCapability, verifySyntheticCapability } from '../src/lib/synthetic-capability';
import { POST } from '../src/app/api/integrations/synthetic/verify/route';
import { normalizeNetworkPolicy } from '../src/lib/network-policy';

beforeAll(async () => { process.env.LOCAL_DATABASE_PATH = 'memory://'; delete process.env.DATABASE_URL;
  await put('ws', 'game', { id: 'game', url: 'https://game.example/play' });
  await put('ws', 'recording', { id: 'recording', gameId: 'game' });
  await query("INSERT INTO jobs(id,workspace_id,kind,state,body,lease_until) VALUES('recording','ws','recording','claimed','{}',now()+interval '2 minutes')");
});
afterAll(async () => { await closeDatabase(); delete process.env.LOCAL_DATABASE_PATH; });
it('mints only for an active scoped recording, binds once, and checks lease on every verification', async () => {
  await expect(mintSyntheticCapability('foreign','recording','game','https://game.example/play')).rejects.toThrow();
  await expect(mintSyntheticCapability('ws','recording','other','https://game.example/play')).rejects.toThrow();
  const capability = await mintSyntheticCapability('ws','recording','game','https://game.example/play');
  const saved = await query<{ id:string; body: Record<string,unknown> }>("SELECT id,body FROM records WHERE kind='synthetic_capability'");
  expect(saved).toHaveLength(1); expect(JSON.stringify(saved)).not.toContain(capability);
  const base = { capability, gameId: 'game', origin: 'https://game.example', guestSessionId: 'guest-1' };
  expect(await verifySyntheticCapability({ ...base, capability: 'public-sdk-key' })).toBe(false);
  expect(await verifySyntheticCapability({ ...base, capability: 'A'.repeat(43) })).toBe(false);
  expect(await verifySyntheticCapability({ ...base, gameId: 'other' })).toBe(false);
  expect(await verifySyntheticCapability({ ...base, origin: 'https://foreign.example' })).toBe(false);
  const response = await POST(new Request('https://blaze.example/api/integrations/synthetic/verify', { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify(base) }));
  expect(response.status).toBe(200); expect(await response.json()).toEqual({ synthetic:true });
  expect(await verifySyntheticCapability(base)).toBe(true);
  expect(await verifySyntheticCapability({ ...base, guestSessionId:'guest-2' })).toBe(false);
  const another = await mintSyntheticCapability('ws','recording','game','https://game.example/play');
  const race = await Promise.all(['guest-a','guest-b'].map(guestSessionId => verifySyntheticCapability({ ...base, capability: another, guestSessionId })));
  expect(race.filter(Boolean)).toHaveLength(1);
  await query("UPDATE jobs SET lease_until=now()-interval '1 second' WHERE id='recording'");
  expect(await verifySyntheticCapability(base)).toBe(false);
  await expect(mintSyntheticCapability('ws','recording','game','https://game.example/play')).rejects.toThrow();
  await query("UPDATE jobs SET lease_until=now()+interval '2 minutes' WHERE id='recording'");
  await query("UPDATE records SET body=jsonb_set(body,'{expiresAt}',to_jsonb('2000-01-01T00:00:00Z'::text)) WHERE kind='synthetic_capability'");
  expect(await verifySyntheticCapability(base)).toBe(false);
  const invalid = await POST(new Request('https://blaze.example/api/integrations/synthetic/verify', { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({ ...base, browserFlag:true }) }));
  expect(invalid.status).toBe(400);
  const oversized = await POST(new Request('https://blaze.example/api/integrations/synthetic/verify', { method:'POST', headers:{'content-type':'application/json'}, body:' '.repeat(2049) }));
  expect(oversized.status).toBe(400);
}, 30000);
it('validates explicit frame paths and rejects wildcards, query strings, ambiguous encoding and excess entries', () => {
  const policy = { resourceOrigins: [], webSocketOrigins: [] };
  expect(normalizeNetworkPolicy({ ...policy, frameUrls:['https://game.example/whot.html'] }).frameUrls).toEqual(['https://game.example/whot.html']);
  for (const value of ['https://*.example/whot.html','https://game.example/whot.html?q=1','https://game.example/%2e%2e/x','http://game.example/whot.html','https://game.example/']) {
    expect(() => normalizeNetworkPolicy({ ...policy, frameUrls:[value] })).toThrow();
  }
  expect(() => normalizeNetworkPolicy({ ...policy, frameUrls:['https://game.example/1','https://game.example/2','https://game.example/3'] })).toThrow();
});
