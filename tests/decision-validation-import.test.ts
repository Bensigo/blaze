import { describe, expect, it } from 'vitest';
import { GET } from '../src/app/fixture/decision-validation.html/forever.json/route';
import { validateForeverJson, isPublicFile } from '../src/lib/forever-json-consumer';
import { foreverManifestUrl } from '../src/lib/game-manifest';
import { isControlledLabTarget } from '../src/lib/target-provenance';

describe('decision lab import and provenance', () => {
  it('provides valid public v1 metadata at the game manifest path', async () => {
    const result = validateForeverJson(await GET().json());
    expect(result.ok).toBe(true);
    if (result.ok) expect(isPublicFile(result.file)).toBe(true);
    expect(foreverManifestUrl('https://blaze.example/fixture/decision-validation.html')).toBe('https://blaze.example/fixture/decision-validation.html/forever.json');
  });
  it('recognizes only the configured origin and exact lab path', () => {
    const app = 'https://BLAZE.example:443/';
    expect(isControlledLabTarget('https://blaze.example/fixture/decision-validation.html', app)).toBe(true);
    for (const target of ['https://other.example/fixture/decision-validation.html','https://blaze.example/fixture/index.html','https://blaze.example/fixture/decision-validation.html?x=1','https://blaze.example/fixture/decision-validation.html/','https://user@blaze.example/fixture/decision-validation.html']) {
      expect(isControlledLabTarget(target, app)).toBe(false);
    }
    expect(isControlledLabTarget('https://blaze.example/fixture/decision-validation.html', undefined)).toBe(false);
    expect(isControlledLabTarget('https://blaze.example/fixture/decision-validation.html', 'https://blaze.example/path')).toBe(false);
  });
});
