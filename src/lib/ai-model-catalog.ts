export type AIProvider = 'anthropic' | 'openrouter';
export type AIModel = {
  id: string;
  name: string;
  compatible: boolean;
  reason?: string;
  contextWindow?: number;
  supportsTools: boolean;
  supportsStructuredOutput: boolean;
};
export type AIModelCatalog = { provider: AIProvider; models: AIModel[]; fetchedAt: string; source: string };

const SOURCES = { anthropic: 'https://api.anthropic.com/v1/models', openrouter: 'https://openrouter.ai/api/v1/models' } as const;
const MAX_BYTES = 8 * 1024 * 1024;
const MAX_MODELS = 5000;
const MAX_PAGES = 10;
const ID = /^[~A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/;
type Obj = Record<string, unknown>;
const object = (value: unknown): Obj | undefined => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Obj : undefined;
const validId = (value: unknown): value is string => typeof value === 'string' && ID.test(value);
const validName = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 200 && !/[\x00-\x1f\x7f]/.test(value);
const context = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : undefined;
const list = (value: unknown): string[] | undefined => Array.isArray(value) && value.length <= 200 && value.every(v => typeof v === 'string' && v.length <= 100) ? value : undefined;

async function readPage(url: string, headers: Record<string, string>): Promise<Obj> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(url, { headers, redirect: 'error', signal: controller.signal, cache: 'no-store' });
    if (!response.ok || !response.body) throw new Error('provider failure');
    const length = response.headers.get('content-length');
    if (length && (!/^\d+$/.test(length) || Number(length) > MAX_BYTES)) throw new Error('oversize');
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_BYTES) { await reader.cancel(); throw new Error('oversize'); }
      chunks.push(value);
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    const parsed = object(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)));
    if (!parsed) throw new Error('bad schema');
    return parsed;
  } catch {
    // Never forward network errors, headers, response bodies, URLs, or keys.
    throw new Error('Unable to fetch or parse the model catalog.');
  } finally { clearTimeout(timer); }
}

function openrouterModel(value: unknown): AIModel & { created: number } {
  const model = object(value);
  if (!model || !validId(model.id) || !validName(model.name)) throw new Error('Invalid model catalog data.');
  const architecture = object(model.architecture);
  const inputs = list(architecture?.input_modalities);
  const outputs = list(architecture?.output_modalities);
  const parameters = list(model.supported_parameters);
  const supportsTools = parameters?.includes('tools') === true;
  const supportsStructuredOutput = parameters?.includes('structured_outputs') === true;
  const reasons: string[] = [];
  if (/^openrouter\/(auto|free)(?::|$)/i.test(model.id)) reasons.push('Choose a specific model, not an automatic router');
  if (!inputs?.includes('text')) reasons.push('Text input not supported or unknown');
  if (!outputs?.includes('text')) reasons.push('Text output not supported or unknown');
  if (!supportsTools) reasons.push('Tool support unavailable or unknown');
  if (!supportsStructuredOutput) reasons.push('Structured output support unavailable or unknown');
  return { id: model.id, name: model.name, compatible: reasons.length === 0, ...(reasons.length ? { reason: reasons.join('; ') } : {}), contextWindow: context(model.context_length), supportsTools, supportsStructuredOutput, created: typeof model.created === 'number' && Number.isFinite(model.created) ? model.created : 0 };
}

// Reviewed 2026-10-29: the official overview guarantees client tool use for
// these exact current Claude API IDs. Unknown aliases and snapshots remain gated.
// https://platform.claude.com/docs/en/models/overview
const CLAUDE_TOOL_MODELS = new Set(['claude-fable-5-1', 'claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5']);

function anthropicModel(value: unknown): AIModel {
  const model = object(value);
  if (!model || !validId(model.id) || !validName(model.display_name)) throw new Error('Invalid model catalog data.');
  const capabilities = object(model.capabilities);
  const structured = object(capabilities?.structured_outputs)?.supported;
  const supportsStructuredOutput = structured === true;
  // Server tools and programmatic tool calling cannot establish client tool support.
  const supportsTools = CLAUDE_TOOL_MODELS.has(model.id);
  const reasons: string[] = [];
  if (!supportsTools) reasons.push('Client tool support unknown');
  if (!supportsStructuredOutput) reasons.push(structured === false ? 'Structured output not supported' : 'Structured output support unknown');
  return { id: model.id, name: model.display_name, compatible: reasons.length === 0, ...(reasons.length ? { reason: reasons.join('; ') } : {}), contextWindow: context(model.max_input_tokens), supportsTools, supportsStructuredOutput };
}

export async function discoverAIModels(provider: AIProvider, secret?: { token: string; workspaceId?: string }): Promise<AIModelCatalog> {
  if (provider !== 'anthropic' && provider !== 'openrouter') throw new Error('Unsupported model provider.');
  if (provider === 'anthropic' && (!secret || typeof secret.token !== 'string' || !secret.token.trim() || secret.token.length > 4096 || /[\r\n]/.test(secret.token))) throw new Error('An Anthropic API key is required.');
  if (provider === 'anthropic' && secret?.workspaceId !== undefined && (!/^[A-Za-z0-9_-]{1,200}$/.test(secret.workspaceId))) throw new Error('Invalid Anthropic workspace ID.');
  const models: AIModel[] = [];
  const ids = new Set<string>();
  let cursor: string | undefined;
  const headers: Record<string, string> = provider === 'anthropic' ? { 'x-api-key': secret!.token, 'anthropic-version': '2023-06-01', ...(secret!.workspaceId ? { 'anthropic-workspace-id': secret!.workspaceId } : {}) } : {};
  for (let page = 0; page < MAX_PAGES; page++) {
    const url = new URL(SOURCES[provider]);
    if (provider === 'anthropic') { url.searchParams.set('limit', '1000'); if (cursor) url.searchParams.set('after_id', cursor); }
    else { url.searchParams.set('output_modalities', 'all'); url.searchParams.set('sort', 'newest'); }
    const data = await readPage(url.toString(), headers);
    if (!Array.isArray(data.data) || data.data.length > MAX_MODELS || models.length + data.data.length > MAX_MODELS) throw new Error('Invalid model catalog data.');
    const entries = provider === 'anthropic' ? data.data.map(anthropicModel) : data.data.map(openrouterModel).sort((a, b) => b.created - a.created).map(({ created: _created, ...model }) => model);
    for (const model of entries) { if (ids.has(model.id)) throw new Error('Invalid model catalog data.'); ids.add(model.id); models.push(model); }
    if (provider === 'openrouter') break;
    if (typeof data.has_more !== 'boolean') throw new Error('Invalid model catalog data.');
    if (!data.has_more) break;
    if (!validId(data.last_id) || data.data.length === 0 || data.last_id !== entries.at(-1)?.id || data.last_id === cursor || page === MAX_PAGES - 1) throw new Error('Invalid model catalog pagination.');
    cursor = data.last_id;
  }
  return { provider, models, fetchedAt: new Date().toISOString(), source: SOURCES[provider] };
}
