import { afterEach, describe, expect, it, vi } from 'vitest';
import { generateText } from 'ai';
import { aiModel, type AIRequestEvent } from '../src/lib/ai-provider';

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
  it('awaits the dispatch observer before fetch and records only safe response metadata', async () => {
    const events: AIRequestEvent[] = [];
    let release!: () => void;
    const persisted = new Promise<void>(resolve => { release = resolve; });
    const observer = vi.fn(async (event: AIRequestEvent) => { events.push(event); if (event.phase === 'dispatched') await persisted; });
    const fetcher = vi.fn().mockResolvedValue(json(routerResponse)); vi.stubGlobal('fetch', fetcher);
    const operation = generateText({ model: aiModel({ token: 'router-secret', model: 'test/example', aiProvider: 'openrouter' }, observer), prompt: 'private prompt', maxRetries: 0 });
    await vi.waitFor(() => expect(observer).toHaveBeenCalledTimes(1));
    expect(fetcher).not.toHaveBeenCalled();
    release();
    await operation;
    expect(events.map(event => event.phase)).toEqual(['dispatched', 'responded']);
    expect(events[1].httpStatus).toBe(200);
    for (const event of events) expect(new Date(event.at).toISOString()).toBe(event.at);
    expect(JSON.stringify(events)).not.toMatch(/secret|private prompt|completion|tokens/);
  });
  it('treats a successful HTTP response as a response even if SDK parsing later fails', async () => {
    const events: AIRequestEvent[] = [];
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ invalid: 'response' })));
    const model = aiModel({ token: 'secret', model: 'test/example', aiProvider: 'openrouter' }, event => { events.push(event); });
    await expect(generateText({ model, prompt: 'test', maxRetries: 0 })).rejects.toThrow();
    expect(events.map(event => event.phase)).toEqual(['dispatched', 'responded']);
  });
  it('does not fetch when selection or dispatch persistence fails', async () => {
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    const observer = vi.fn();
    const selection = aiModel({ token: 'secret', model: 'test/example', aiProvider: 'openrouter', assertAISelection: async () => { throw new Error('secret'); } }, observer);
    await expect(generateText({ model: selection, prompt: 'test', maxRetries: 0 })).rejects.toThrow();
    expect(observer).toHaveBeenCalledOnce();
    expect(observer.mock.calls[0][0]).toMatchObject({ phase: 'failed', errorCode: 'selection_changed' });
    const failingObserver = vi.fn().mockRejectedValue(new Error('secret'));
    const model = aiModel({ token: 'secret', model: 'test/example', aiProvider: 'openrouter' }, failingObserver);
    await expect(generateText({ model, prompt: 'test', maxRetries: 0 })).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each([[401, 'access_denied'], [403, 'access_denied'], [402, 'billing_required'], [429, 'rate_limited'], [503, 'provider_unavailable'], [400, 'request_failed']] as const)('records safe HTTP failure %i', async (status, errorCode) => {
    const events: AIRequestEvent[] = [];
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ error: 'secret provider body' }, status)));
    const model = aiModel({ token: 'secret', model: 'test/example', aiProvider: 'openrouter' }, event => { events.push(event); });
    await expect(generateText({ model, prompt: 'test', maxRetries: 0 })).rejects.toThrow();
    expect(events.map(event => event.phase)).toEqual(['dispatched', 'failed']);
    expect(events[1]).toMatchObject({ httpStatus: status, errorCode });
    expect(JSON.stringify(events)).not.toContain('secret');
  });
  it('records a safe network failure', async () => {
    const events: AIRequestEvent[] = [];
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('secret network detail')));
    const model = aiModel({ token: 'secret', model: 'test/example', aiProvider: 'openrouter' }, event => { events.push(event); });
    await expect(generateText({ model, prompt: 'test', maxRetries: 0 })).rejects.toThrow();
    expect(events[1]).toMatchObject({ phase: 'failed', errorCode: 'provider_unavailable' });
    expect(JSON.stringify(events)).not.toContain('secret');
  });

});
