import { afterEach, describe, expect, it, vi } from 'vitest';
import { discoverAIModels } from '../src/lib/ai-model-catalog';

const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
const routerModel = (id: string, overrides = {}) => ({ id, name: id, created: 1, context_length: 1000, architecture: { input_modalities: ['text'], output_modalities: ['text'] }, supported_parameters: ['tools', 'structured_outputs'], ...overrides });
const claudeModel = (id: string, structured: unknown = true) => ({ id, display_name: id, max_input_tokens: 1000, capabilities: { structured_outputs: { supported: structured } } });
afterEach(() => vi.unstubAllGlobals());

describe('discoverAIModels', () => {
  it('returns newest OpenRouter entries including incompatible and unknown capabilities', async () => {
    const fetcher = vi.fn().mockResolvedValue(response({ data: [routerModel('a/older'), routerModel('a/new', { created: 5, architecture: { input_modalities: ['audio'], output_modalities: ['text'] } }), routerModel('a/unknown', { supported_parameters: null })] }));
    vi.stubGlobal('fetch', fetcher);
    const result = await discoverAIModels('openrouter', { token: 'ignored-secret' });
    expect(result.models.map(m => m.id)).toEqual(['a/new', 'a/older', 'a/unknown']);
    expect(result.models[0]).toMatchObject({ compatible: false, reason: expect.stringContaining('Text input') });
    expect(result.models[1]).toMatchObject({ compatible: true, supportsTools: true, supportsStructuredOutput: true, contextWindow: 1000 });
    expect(result.models[2]).toMatchObject({ compatible: false, supportsTools: false, supportsStructuredOutput: false });
    expect(fetcher.mock.calls[0][0]).toBe('https://openrouter.ai/api/v1/models?output_modalities=all&sort=newest');
    expect(fetcher.mock.calls[0][1]).toMatchObject({ headers: {}, redirect: 'error', cache: 'no-store' });
    expect(JSON.stringify(result)).not.toContain('ignored-secret');
  });
  it('requires a key and paginates Anthropic using only validated IDs', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(response({ data: [claudeModel('claude-opus-5-5')], has_more: true, last_id: 'claude-opus-5-5' })).mockResolvedValueOnce(response({ data: [claudeModel('second', false)], has_more: false, last_id: 'second' }));
    vi.stubGlobal('fetch', fetcher);
    await expect(discoverAIModels('anthropic')).rejects.toThrow('required');
    expect(fetcher).not.toHaveBeenCalled();
    const result = await discoverAIModels('anthropic', { token: 'secret-token', workspaceId: 'workspace_1' });
    expect(result.models).toHaveLength(2);
    expect(result.models[0]).toMatchObject({ compatible: true, supportsTools: true, supportsStructuredOutput: true });
    expect(result.models[1]).toMatchObject({ compatible: false, supportsTools: false, supportsStructuredOutput: false, reason: expect.stringContaining('unknown') });
    expect(fetcher.mock.calls[1][0]).toBe('https://api.anthropic.com/v1/models?limit=1000&after_id=claude-opus-5-5');
    expect(fetcher.mock.calls[0][1].headers).toEqual({ 'x-api-key': 'secret-token', 'anthropic-version': '2023-06-01', 'anthropic-workspace-id': 'workspace_1' });
    expect(JSON.stringify(result)).not.toContain('secret-token');
  });
  it('fails on malformed schema, unsafe cursors, duplicate IDs, and excessive bodies', async () => {
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    fetcher.mockResolvedValueOnce(response({ data: [{ id: '../bad?', name: 'bad' }] }));
    await expect(discoverAIModels('openrouter')).rejects.toThrow('Invalid model catalog data');
    fetcher.mockResolvedValueOnce(response({ data: [claudeModel('first')], has_more: true, last_id: 'https://evil.test' }));
    await expect(discoverAIModels('anthropic', { token: 'x' })).rejects.toThrow('pagination');
    fetcher.mockResolvedValueOnce(response({ data: [routerModel('a/a'), routerModel('a/a')] }));
    await expect(discoverAIModels('openrouter')).rejects.toThrow('Invalid model catalog data');
    fetcher.mockResolvedValueOnce(new Response('x', { headers: { 'content-length': '9000000' } }));
    await expect(discoverAIModels('openrouter')).rejects.toThrow('Unable to fetch or parse');
  });
  it('sanitizes provider and network failures without exposing secrets', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(response({ error: 'secret-token provider details' }, 401)).mockRejectedValueOnce(new Error('secret-token details'));
    vi.stubGlobal('fetch', fetcher);
    for (let i = 0; i < 2; i++) {
      try { await discoverAIModels('anthropic', { token: 'secret-token' }); throw new Error('expected failure'); }
      catch (error) { expect(String(error)).toBe('Error: Unable to fetch or parse the model catalog.'); }
    }
  });
});
