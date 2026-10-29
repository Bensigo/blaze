import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import type { LanguageModel } from 'ai';
import type { ProviderSecret } from './types';

export type AIRequestErrorCode = 'access_denied' | 'billing_required' | 'rate_limited' | 'provider_unavailable' | 'request_failed' | 'selection_changed';
export type AIRequestEvent = {
  phase: 'dispatched' | 'responded' | 'failed';
  at: string;
  httpStatus?: number;
  errorCode?: AIRequestErrorCode;
};
export type AIRequestObserver = (event: AIRequestEvent) => void | Promise<void>;

const failureCode = (status: number): AIRequestErrorCode => {
  if (status === 401 || status === 403) return 'access_denied';
  if (status === 402) return 'billing_required';
  if (status === 429) return 'rate_limited';
  if (status >= 500) return 'provider_unavailable';
  return 'request_failed';
};

// Keep SDK errors from forwarding provider bodies, which may contain private data.
const guardedFetch = (guard?: () => Promise<void>, observer?: AIRequestObserver): typeof fetch => async (input, init) => {
  const record = async (event: Omit<AIRequestEvent, 'at'>) => {
    if (observer) await observer({ ...event, at: new Date().toISOString() });
  };
  try {
    try { if (guard) await guard(); }
    catch {
      await record({ phase: 'failed', errorCode: 'selection_changed' });
      throw new Error('AI provider request failed.');
    }
    // Await durable observation before allowing a provider request to leave.
    await record({ phase: 'dispatched' });
    let response: Response;
    try { response = await fetch(input, { ...init, redirect: 'error' }); }
    catch {
      await record({ phase: 'failed', errorCode: 'provider_unavailable' });
      throw new Error('AI provider request failed.');
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      await record({ phase: 'failed', httpStatus: response.status, errorCode: failureCode(response.status) });
      return new Response(JSON.stringify({ error: { message: 'AI provider request failed.' } }), {
        status: response.status,
        headers: { 'content-type': 'application/json' },
      });
    }
    await record({ phase: 'responded', httpStatus: response.status });
    return response;
  } catch {
    throw new Error('AI provider request failed.');
  }
};

/** Construct exactly the requested provider/model. Absent provider means a legacy Anthropic secret. */
export function aiModel(secret: ProviderSecret, observer?: AIRequestObserver): LanguageModel {
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
      fetch: guardedFetch(guard, observer),
    })(secret.model);
  }
  if (/^openrouter\/(auto|free)(?::|$)/i.test(secret.model)) throw new Error('Select a specific OpenRouter model.');
  return createOpenRouter({
    baseURL: 'https://openrouter.ai/api/v1',
    apiKey: secret.token,
    compatibility: 'strict',
    fetch: guardedFetch(guard, observer),
  }).chat(secret.model, { provider: { require_parameters: true, allow_fallbacks: false } });
}
