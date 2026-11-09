import { beforeAll, beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ workspace: 'a' }));
vi.mock('../src/lib/auth', async () => {
  const actual = await vi.importActual<typeof import('../src/lib/auth')>('../src/lib/auth');
  return { ...actual, requireIdentity: async () => ({ workspace_id: state.workspace }) };
});
let db: typeof import('../src/lib/db');
let route: typeof import('../src/app/api/actions/route');
beforeAll(async () => {
  delete process.env.DATABASE_URL;
  delete process.env.VERCEL;
  process.env.LOCAL_DATABASE_PATH = 'memory://';
  process.env.APP_URL = 'http://localhost:3000';
  db = await import('../src/lib/db');
  route = await import('../src/app/api/actions/route');
});
beforeEach(async () => {
  state.workspace = 'a';
  await db.query('DELETE FROM records');
  await db.put('a', 'game', { id: 'g', title: 'Game', url: 'https://example.com/game', origins: ['https://example.com'], competitors: [] });
});
const post = (body: object) => route.POST(new Request('http://localhost:3000/api/actions', {
  method: 'POST', headers: { origin: 'http://localhost:3000', 'content-type': 'application/json' }, body: JSON.stringify(body),
}));
it('rejects retired AI, gameplay and social actions without outbound requests', async () => {
  const outbound = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Unexpected external request'));
  try {
    for (const action of ['queue_recording', 'run_research', 'generate_draft', 'publish_post']) {
      const response = await post({ action, gameId: 'g', confirmAIUsage: true });
      expect(response.status).toBe(400);
      expect((await response.json()).error).toBe('Unknown action.');
    }
    expect(outbound).not.toHaveBeenCalled();
  } finally { outbound.mockRestore(); }
});
it('keeps game updates scoped to the signed-in workspace', async () => {
  state.workspace = 'b';
  const response = await post({ action: 'update_game', id: 'g', title: 'Changed' });
  expect(response.status).toBe(404);
  expect((await db.get<{ title: string }>('a', 'game', 'g'))?.title).toBe('Game');
});
