import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ manifest: vi.fn(), fetch: vi.fn() }));
vi.mock('../src/lib/game-manifest', () => ({ isLocalFixture: () => false, readGameManifest: mocks.manifest }));
vi.mock('../src/lib/integrations/safe-fetch', () => ({ fetchPublic: mocks.fetch }));
import { gameMetadata } from '../src/lib/metadata';
beforeEach(() => { mocks.manifest.mockReset(); mocks.fetch.mockReset(); });
it('imports only public page metadata with recorded provenance', async () => {
  mocks.manifest.mockResolvedValue({ status: 'unavailable' });
  mocks.fetch.mockResolvedValue({ status: 200, url: 'https://game.example/play', contentType: 'text/html; charset=utf-8', body: '<title>Page title</title><meta property="og:title" content="Game"><meta name="description" content="Play together"><meta property="og:image" content="/cover.png">' });
  const result = await gameMetadata('https://game.example/play', 'https://app.example');
  expect(result).toMatchObject({ title: 'Game', description: 'Play together', image: 'https://game.example/cover.png', genre: '', metadataStatus: 'Public page metadata', pageSource: { url: 'https://game.example/play' } });
  expect(result.pageSource?.sha256).toHaveLength(64);
  expect(mocks.fetch).toHaveBeenCalledWith('https://game.example/play', 0);
});
it('rejects pages that cannot be fetched safely and does not invent a title', async () => {
  mocks.manifest.mockResolvedValue({ status: 'unavailable' });
  mocks.fetch.mockRejectedValue(new Error('private address'));
  await expect(gameMetadata('http://127.0.0.1/game', 'https://app.example')).rejects.toThrow('safely');
  mocks.fetch.mockResolvedValue({ status: 200, url: 'https://game.example', contentType: 'text/html', body: '<p>Untitled</p>' });
  await expect(gameMetadata('https://game.example', 'https://app.example')).rejects.toThrow('no title');
});
it('prefers a validated manifest without fetching the page', async () => {
  mocks.manifest.mockResolvedValue({ status: 'complete', facts: { name: 'Manifest name', description: 'Description', genre: 'Cards', media: { cover: { src: '/cover.png' } } }, source: { url: 'https://game.example/play/forever.json', observedAt: '2026-01-01', sha256: 'abc', formatVersion: 1 } });
  const result = await gameMetadata('https://game.example/play', 'https://app.example');
  expect(result).toMatchObject({ title: 'Manifest name', metadataStatus: 'Forever manifest', manifestSource: { sha256: 'abc' } });
  expect(mocks.fetch).not.toHaveBeenCalled();
});
