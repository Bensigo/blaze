type Action = { id: string; label: string };
/** Calls the OpenRouter System One API; never include provider response text in errors. */
export async function choose(state: unknown, actions: Action[], key: string, model: string, timeoutMs = 12000): Promise<string> {
  if (!['typesafe/jev-1.13', 'typesafe/jev-1.14'].includes(model) || !key || actions.length < 2 || new Set(actions.map(a => a.id)).size !== actions.length || actions.some(a => !/^[a-zA-Z0-9_-]{1,40}$/.test(a.id))) throw new Error('Invalid Jev decision request');
  const criteria = Object.fromEntries(actions.map(a => [a.id, a.label]));
  try {
    const res = await fetch('https://openrouter.ai/api/v1/systemone', {
      method: 'POST', headers: {Authorization: `Bearer ${key}`, 'Content-Type': 'application/json'},
      body: JSON.stringify({model, state, questions: {next: {type: 'choice', instructions: 'Choose the next gameplay action from the allowed options.', criteria}}}),
      signal: AbortSignal.timeout(Math.max(1, Math.min(12000, timeoutMs))), redirect: 'error',
    });
    if (!res.ok || !res.body) throw new Error();
    const reader = res.body.getReader(); let size = 0; const chunks: Uint8Array[] = [];
    for (;;) { const part = await reader.read(); if (part.done) break; size += part.value.byteLength; if (size > 65536) { await reader.cancel(); throw new Error(); } chunks.push(part.value); }
    const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    const json = JSON.parse(new TextDecoder('utf-8', {fatal:true}).decode(bytes));
    if (typeof json?.model !== 'string' || (json.model !== model && !new RegExp(`^${model.replace('.', '\\.')}[-][0-9]{8}$`).test(json.model))) throw new Error();
    const selected = json?.answers?.next?.choice;
    if (json?.answers?.next?.type !== 'choice' || typeof selected !== 'string' || !actions.some(a => a.id === selected)) throw new Error();
    return selected;
  } catch { throw new Error('Jev decision failed or returned an invalid action'); }
}
