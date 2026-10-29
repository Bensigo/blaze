import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import type { LanguageModel } from 'ai';
import type { ProviderSecret } from './types';

// Keep SDK errors from forwarding provider bodies, which may contain private data.
const guardedFetch = (guard?: () => Promise<void>): typeof fetch => async (input, init) => {
  try {
    if (guard) await guard();
    const response = await fetch(input, { ...init, redirect: 'error' });
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      return new Response(JSON.stringify({ error: { message: 'AI provider request failed.' } }), {
        status: response.status,
        headers: { 'content-type': 'application/json' },
      });
    }
    return response;
  } catch {
    throw new Error('AI provider request failed.');
  }
};

/** Construct exactly the requested provider/model. Absent provider means a legacy Anthropic secret. */
export function aiModel(secret: ProviderSecret): LanguageModel {
  if (!secret || typeof secret.token !== 'string' || !secret.token.trim() || /[\r\n]/.test(secret.token) || typeof secret.model !== 'string' || !/^[~A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/.test(secret.model)) {
    throw new Error('Connect an AI provider and configure a model.');
  }
  const guard = typeof secret.assertAISelection === 'function' ? secret.assertAISelection as () => Promise<void> : undefined;
  const provider = secret.aiProvider === undefined ? 'anthropic' : secret.aiProvider;
  if (provider !== 'anthropic' && provider !== 'openrouter') throw new Error('Invalid AI provider.');
  if (provider === 'anthropic') {
    if (secret.workspaceId !== undefined && (typeof secret.workspaceId !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(secret.workspaceId))) throw new Error('Invalid Anthropic workspace ID.');
    return createAnthropic({
      baseURL: 'https://api.anthropic.com/v1',
      apiKey: secret.token,
      headers: typeof secret.workspaceId === 'string' ? { 'anthropic-workspace-id': secret.workspaceId } : {},
      fetch: guardedFetch(guard),
    })(secret.model);
  }
  if (/^openrouter\/(auto|free)(?::|$)/i.test(secret.model)) throw new Error('Select a specific OpenRouter model.');
  return createOpenRouter({
    baseURL: 'https://openrouter.ai/api/v1',
    apiKey: secret.token,
    compatibility: 'strict',
    fetch: guardedFetch(guard),
  }).chat(secret.model, { provider: { require_parameters: true, allow_fallbacks: false } });
}
