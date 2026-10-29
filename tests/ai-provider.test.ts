import { afterEach, describe, expect, it, vi } from 'vitest';
import { generateText } from 'ai';
import { aiModel } from '../src/lib/ai-provider';

afterEach(() => vi.unstubAllGlobals());
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const anthropicResponse = { id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-test', content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } };
const routerResponse = { id: 'r1', object: 'chat.completion', created: 1, model: 'test/example', choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } };

describe('aiModel', () => {
  it('sends selected OpenRouter model and strict routing preferences to its official endpoint', async () => {
    const fetcher = vi.fn().mockResolvedValue(json(routerResponse)); vi.stubGlobal('fetch', fetcher);
    const result = await generateText({ model: aiModel({ token: 'router-secret', model: 'test/example', aiProvider: 'openrouter' }), prompt: 'test', maxRetries: 0 });
    expect(result.text).toBe('ok');
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(init.redirect).toBe('error');
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer router-secret');
    expect(JSON.parse(init.body)).toMatchObject({ model: 'test/example', provider: { require_parameters: true, allow_fallbacks: false } });
    expect(JSON.parse(init.body).models).toBeUndefined();
    expect(JSON.stringify(result)).not.toContain('router-secret');
  });
  it('uses Anthropic for legacy and explicit selection, including workspace header', async () => {
    const fetcher = vi.fn().mockImplementation(async () => json(anthropicResponse)); vi.stubGlobal('fetch', fetcher);
    for (const aiProvider of [undefined, 'anthropic']) {
      const result = await generateText({ model: aiModel({ token: 'anthropic-secret', model: 'claude-test', workspaceId: 'workspace_1', aiProvider }), prompt: 'test', maxRetries: 0 });
      expect(result.text).toBe('ok');
      expect(JSON.stringify(result)).not.toContain('anthropic-secret');
    }
    for (const [url, init] of fetcher.mock.calls) {
      expect(url).toBe('https://api.anthropic.com/v1/messages');
      expect(init.redirect).toBe('error');
      const headers = new Headers(init.headers);
      expect(headers.get('x-api-key')).toBe('anthropic-secret');
      expect(headers.get('anthropic-workspace-id')).toBe('workspace_1');
      expect(JSON.parse(init.body).model).toBe('claude-test');
    }
  });
  it('rejects missing or invalid inputs and auto routers without calling a provider', () => {
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    expect(() => aiModel({ token: '', model: 'a' })).toThrow();
    expect(() => aiModel({ token: 'x', model: ' ' })).toThrow();
    expect(() => aiModel({ token: 'x', model: 'a', aiProvider: null })).toThrow('Invalid AI provider');
    expect(() => aiModel({ token: 'x', model: 'openrouter/auto', aiProvider: 'openrouter' })).toThrow('specific');
    expect(() => aiModel({ token: 'x', model: 'openrouter/auto ', aiProvider: 'openrouter' })).toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('does not fall back or leak secrets on provider and network errors', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(json({ error: 'router-secret' }, 401)).mockRejectedValueOnce(new Error('router-secret'));
    vi.stubGlobal('fetch', fetcher);
    for (let i = 0; i < 2; i++) {
      try { await generateText({ model: aiModel({ token: 'router-secret', model: 'test/example', aiProvider: 'openrouter' }), prompt: 'test', maxRetries: 0 }); throw new Error('expected failure'); }
      catch (error) { expect(String(error)).not.toContain('router-secret'); }
    }
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls.every(([url]) => url === 'https://openrouter.ai/api/v1/chat/completions')).toBe(true);
  });
});
