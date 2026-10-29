import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ discover: vi.fn(), jev: vi.fn() }));
vi.mock('../src/lib/ai-model-catalog', () => ({ discoverAIModels: mocks.discover }));
vi.mock('../src/lib/integrations/social', () => ({ testConnection: mocks.jev }));
let db: typeof import('../src/lib/db');
let credentials: typeof import('../src/lib/credentials');
let settings: typeof import('../src/lib/ai-settings');

const compatible = (id: string, compatible = true) => ({ id, name: id, compatible, supportsTools: compatible, supportsStructuredOutput: compatible });
const catalog = (provider: 'anthropic' | 'openrouter', models = [compatible('example/model')]) => ({ provider, models, fetchedAt: '2026-01-01T00:00:00Z', source: 'fixture' });
const connection = (id: string, provider: string, model?: string) => ({ id, provider, model, connected: true, checkedAt: '2026-01-01T00:00:00Z', label: id });
const addKey = async (workspace: string, id: string, provider: string, token: string, model?: string) => {
  await db.put(workspace, 'connection', connection(id, provider, model));
  await credentials.saveSecret(workspace, id, { token, ...(model ? { model } : {}) });
};

beforeAll(async () => {
  delete process.env.DATABASE_URL;
  delete process.env.VERCEL;
  process.env.LOCAL_DATABASE_PATH = 'memory://';
  process.env.CREDENTIALS_ENCRYPTION_KEY = randomBytes(32).toString('hex');
  db = await import('../src/lib/db');
  credentials = await import('../src/lib/credentials');
  settings = await import('../src/lib/ai-settings');
});
afterAll(async () => { await db.closeDatabase(); vi.unstubAllGlobals(); });
beforeEach(async () => {
  await db.query('DELETE FROM records');
  await db.query('DELETE FROM credentials');
  mocks.discover.mockReset().mockImplementation(async (provider) => catalog(provider));
  mocks.jev.mockReset().mockResolvedValue({ connected: true });
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: {} }), { status: 200 })));
});

describe('AI account settings', () => {
  it('reuses exactly one legacy Anthropic connection and refuses an arbitrary choice', async () => {
    await addKey('one', 'old', 'anthropic', 'legacy-token', 'example/model');
    expect(await settings.readAISettings('one')).toMatchObject({ provider: 'anthropic', connectionId: 'old', legacy: true });
    expect(await settings.resolveAISecret('one')).toMatchObject({ token: 'legacy-token', model: 'example/model', aiProvider: 'anthropic' });
    await addKey('one', 'other', 'anthropic', 'other-token', 'example/model');
    expect(await settings.readAISettings('one')).toBeNull();
    await expect(settings.resolveAISecret('one')).rejects.toThrow('Choose an AI provider');
  });
  it('saves and reloads model and encrypted key without exposing it in metadata', async () => {
    const input = settings.settingsInput.parse({ provider: 'anthropic', token: 'anthropic-secret', model: 'example/model', workspaceId: 'workspace_1' });
    const saved = await settings.saveAISettings('alpha', input);
    expect(await settings.readAISettings('alpha')).toEqual(saved);
    expect(await settings.resolveAISecret('alpha')).toMatchObject({ token: 'anthropic-secret', aiProvider: 'anthropic', workspaceId: 'workspace_1' });
    const state = await settings.accountAIState('alpha');
    const records = await db.query('SELECT body FROM records WHERE workspace_id=$1', ['alpha']);
    const rows = await db.query<{encrypted:string}>('SELECT encrypted FROM credentials WHERE workspace_id=$1', ['alpha']);
    expect(rows).toHaveLength(1);
    expect(JSON.stringify([saved, state, records, rows])).not.toContain('anthropic-secret');
    expect(mocks.discover).toHaveBeenCalledWith('anthropic', { token: 'anthropic-secret', workspaceId: 'workspace_1' });
  });
  it('isolates connection IDs by workspace and switches only to the selected provider and key', async () => {
    await addKey('alpha', 'a-key', 'anthropic', 'anthropic-secret', 'example/model');
    await addKey('alpha', 'or-key', 'openrouter', 'router-secret', 'example/model');
    await addKey('beta', 'foreign', 'openrouter', 'foreign-secret', 'example/model');
    await expect(settings.saveAISettings('alpha', { provider: 'openrouter', connectionId: 'foreign', model: 'example/model' })).rejects.toThrow('unavailable in this workspace');
    const saved = await settings.saveAISettings('alpha', { provider: 'openrouter', connectionId: 'or-key', model: 'example/model' });
    expect(saved.connectionId).toBe('or-key');
    expect(mocks.discover).toHaveBeenLastCalledWith('openrouter', { token: 'router-secret' });
    const fetcher = vi.mocked(fetch);
    expect(fetcher.mock.calls[0][0]).toBe('https://openrouter.ai/api/v1/key');
    expect(fetcher.mock.calls[0][1]).toMatchObject({ headers: { Authorization: 'Bearer router-secret' }, redirect: 'error' });
    expect(await settings.resolveAISecret('alpha')).toMatchObject({ token: 'router-secret', aiProvider: 'openrouter', aiConnectionId: 'or-key' });
    mocks.discover.mockResolvedValueOnce(catalog('openrouter', []));
    await expect(settings.resolveAISecret('alpha')).rejects.toThrow('unavailable or incompatible');
    mocks.discover.mockResolvedValueOnce(catalog('openrouter', [compatible('example/model', false)]));
    await expect(settings.resolveAISecret('alpha')).rejects.toThrow('unavailable or incompatible');
  });
  it('retains prior settings and encrypted credential after model or key verification fails', async () => {
    const original = await settings.saveAISettings('alpha', { provider: 'anthropic', token: 'original-secret', model: 'example/model' });
    mocks.discover.mockResolvedValueOnce(catalog('anthropic', [compatible('example/model', false)]));
    await expect(settings.saveAISettings('alpha', { provider: 'anthropic', connectionId: original.connectionId, token: 'replacement-secret', model: 'example/model' })).rejects.toThrow('does not support');
    mocks.discover.mockResolvedValueOnce(catalog('anthropic', []));
    await expect(settings.saveAISettings('alpha', { provider: 'anthropic', connectionId: original.connectionId, model: 'example/model' })).rejects.toThrow('no longer available');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('secret', { status: 401 })));
    await expect(settings.saveAISettings('alpha', { provider: 'openrouter', token: 'router-secret', model: 'example/model' })).rejects.toThrow('verification failed');
    expect(await settings.readAISettings('alpha')).toEqual(original);
    expect((await credentials.secretForConnection('alpha', original.connectionId))?.token).toBe('original-secret');
    expect((await settings.accountAIState('alpha')).credentials).toHaveLength(1);
  });
  it('validates the public input schemas', () => {
    for (const value of [
      { provider: 'wrong', token: '12345678', model: 'example/model' },
      { provider: 'anthropic', token: 'short', model: 'example/model' },
      { provider: 'anthropic', token: '1234\n5678', model: 'example/model' },
      { provider: 'anthropic', token: '12345678', model: '../ bad' },
      { provider: 'anthropic', token: '12345678', model: 'example/model', extra: 'x' },
    ]) expect(settings.settingsInput.safeParse(value).success).toBe(false);
    expect(settings.jevInput.safeParse({ token: 'short' }).success).toBe(false);
  });
  it('selects a workspace OpenRouter key and decision model without fallback', async () => {
    await addKey('alpha', 'legacy', 'jev', 'old-typesafe-secret');
    await addKey('alpha', 'router', 'openrouter', 'router-secret', 'example/model');
    await addKey('beta', 'foreign', 'openrouter', 'foreign-secret');
    expect(await credentials.secretFor('alpha', 'jev')).toBeUndefined();
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async (url: string) => new Response(JSON.stringify(url.endsWith('/key') ? {data:{}} : {data:{id:'typesafe/jev-1.13',architecture:{input_modalities:['text'],output_modalities:['decisions']},endpoints:[{status:0,provider_name:'TypeSafe'}]}}))));
    await expect(settings.saveJevSettings('alpha',{connectionId:'foreign',model:'typesafe/jev-1.13'})).rejects.toThrow('unavailable in this workspace');
    const saved = await settings.saveJevSettings('alpha',{connectionId:'router',model:'typesafe/jev-1.13'});
    expect(saved.id).toBe('router');
    expect(await credentials.secretFor('alpha','jev')).toMatchObject({token:'router-secret',model:'typesafe/jev-1.13'});
    expect((await credentials.secretForConnection('alpha','router'))?.model).toBe('example/model');
    expect(JSON.stringify(await settings.accountAIState('alpha'))).not.toContain('router-secret');
    await credentials.saveSecret('alpha','router',{token:'changed-secret'});
    expect(await credentials.secretFor('alpha','jev')).toBeUndefined();
  });
  it('rejects unavailable decision model and invalid key without saving', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async (url:string) => new Response(JSON.stringify(url.endsWith('/key') ? {data:{}} : {data:{id:'typesafe/jev-router',architecture:{input_modalities:['text'],output_modalities:['text']},endpoints:[]}}))));
    await expect(settings.saveJevSettings('alpha',{token:'router-secret',model:'typesafe/jev-1.13'})).rejects.toThrow('unavailable');
    expect(await credentials.secretFor('alpha','jev')).toBeUndefined();
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async (url:string) => url.endsWith('/key') ? new Response('',{status:401}) : new Response(JSON.stringify({data:{id:'typesafe/jev-1.13',architecture:{input_modalities:['text'],output_modalities:['decisions']},endpoints:[{status:0,provider_name:'TypeSafe'}]}}))));
    await expect(settings.saveJevSettings('alpha',{token:'router-secret',model:'typesafe/jev-1.13'})).rejects.toThrow('verification failed');
  });
  it('bounds Jev metadata and rejects malformed schemas', async () => {
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response('x'.repeat(65537))));
    await expect(settings.verifyJevModel('typesafe/jev-1.13')).rejects.toThrow('unavailable');
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(JSON.stringify({data:{id:'typesafe/jev-1.13',architecture:{input_modalities:'text',output_modalities:['decisions']},endpoints:[]}}))));
    await expect(settings.verifyJevModel('typesafe/jev-1.13')).rejects.toThrow('unavailable');
  });
  it('fails closed if the reused OpenRouter credential rotates while Jev verification runs', async () => {
    await addKey('alpha','router','openrouter','router-secret','example/model');
    let release!:()=>void; let started!:()=>void; const entered=new Promise<void>(r=>{started=r});
    vi.stubGlobal('fetch',vi.fn().mockImplementation(async(url:string)=>{
      if(url.endsWith('/key')) {started();await new Promise<void>(r=>{release=r});return new Response(JSON.stringify({data:{}}));}
      return new Response(JSON.stringify({data:{id:'typesafe/jev-1.13',architecture:{input_modalities:['text'],output_modalities:['decisions']},endpoints:[{status:0,provider_name:'TypeSafe'}]}}));
    }));
    const pending=settings.saveJevSettings('alpha',{connectionId:'router',model:'typesafe/jev-1.13'}); await entered;
    await credentials.saveSecret('alpha','router',{token:'rotated-secret'});release();
    await expect(pending).rejects.toThrow('Settings changed');
    expect(await credentials.secretFor('alpha','jev')).toBeUndefined();
  });
  it('rejects selection changes while the live catalog is in flight', async () => {
    const saved = await settings.saveAISettings('alpha', {provider:'anthropic',token:'original-secret',model:'example/model'});
    let release!: () => void; let started!: () => void;
    const entered = new Promise<void>(r => {started=r});
    mocks.discover.mockImplementationOnce(async () => {started(); await new Promise<void>(r=>{release=r}); return catalog('anthropic');});
    const pending = settings.resolveAISecret('alpha'); await entered;
    await db.put('alpha','ai_settings',{...saved,revision:'other-revision'}); release();
    await expect(pending).rejects.toThrow('changed');
  });
  it('rejects a stale save when the selected key was disconnected while verification ran', async () => {
    const saved = await settings.saveAISettings('alpha', {provider:'anthropic',token:'original-secret',model:'example/model'});
    let release!: () => void; let started!: () => void;
    const entered = new Promise<void>(r=>{started=r});
    mocks.discover.mockImplementationOnce(async () => {started(); await new Promise<void>(r=>{release=r}); return catalog('anthropic');});
    const pending = settings.saveAISettings('alpha',{provider:'anthropic',connectionId:saved.connectionId,model:'example/model'}); await entered;
    const prior = await db.get<Record<string,unknown> & {id:string}>('alpha','connection',saved.connectionId);
    await db.put('alpha','connection',{...prior!,connected:false}); release();
    await expect(pending).rejects.toThrow('Settings changed');
    expect((await db.get<{id:string;connected:boolean}>('alpha','connection',saved.connectionId))?.connected).toBe(false);
    expect(await settings.readAISettings('alpha')).toEqual(saved);
  });
  it('does not resurrect a connection deleted while verification runs', async () => {
    const saved = await settings.saveAISettings('alpha', {provider:'anthropic',token:'original-secret',model:'example/model'});
    let release!: () => void; let started!: () => void; const entered = new Promise<void>(r=>{started=r});
    mocks.discover.mockImplementationOnce(async () => {started(); await new Promise<void>(r=>{release=r}); return catalog('anthropic');});
    const pending=settings.saveAISettings('alpha',{provider:'anthropic',connectionId:saved.connectionId,model:'example/model'}); await entered;
    await db.query("DELETE FROM records WHERE workspace_id=$1 AND kind='connection' AND id=$2",['alpha',saved.connectionId]); release();
    await expect(pending).rejects.toThrow('Settings changed');
    expect(await db.get('alpha','connection',saved.connectionId)).toBeUndefined();
  });
  it('guard detects same-ID credential rotation before SDK fetch', async () => {
    const saved = await settings.saveAISettings('alpha',{provider:'anthropic',token:'original-secret',model:'example/model'});
    const secret=await settings.resolveAISecret('alpha');
    expect(JSON.stringify(secret)).not.toContain('assertAISelection');
    await settings.saveAISettings('alpha',{provider:'anthropic',connectionId:saved.connectionId,token:'rotated-secret',model:'example/model'});
    const {aiModel}=await import('../src/lib/ai-provider'); const {generateText}=await import('ai');
    const fetcher=vi.fn(); vi.stubGlobal('fetch',fetcher);
    await expect(generateText({model:aiModel(secret),prompt:'test',maxRetries:0})).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('bounds the OpenRouter key response before parsing', async () => {
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response('x'.repeat(65537))));
    await expect(settings.saveAISettings('alpha',{provider:'openrouter',token:'router-secret',model:'example/model'})).rejects.toThrow('verification failed');
    expect(await settings.readAISettings('alpha')).toBeNull();
  });

});
