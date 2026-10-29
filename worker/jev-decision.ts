type Action = { id: string; label: string };
// Transport bounds, not provider token limits or a monetary ceiling.
export const JEV_MAX_STATE_CHARS = 8000;
export const JEV_MAX_REQUEST_BYTES = 16384;
export const JEV_MAX_RESPONSE_BYTES = 65536;
export type JevAudit =
  | { type: "dispatch"; model: string; requestBytes: number }
  | {
      type: "response";
      model: string;
      responseBytes: number;
      inputTokens: number | null;
      outputTokens: number | null;
      cost: number | null;
    };
/** Calls the OpenRouter System One API; never include provider response text in errors. */
export async function choose(
  state: unknown,
  actions: Action[],
  key: string,
  model: string,
  timeoutMs = 12000,
  beforeDispatch: () => Promise<void>,
  audit?: (event: JevAudit) => void,
): Promise<string> {
  if (
    !["typesafe/jev-1.13", "typesafe/jev-1.14"].includes(model) ||
    !key ||
    !Number.isFinite(timeoutMs) ||
    timeoutMs <= 0 ||
    !Array.isArray(actions) ||
    actions.length < 2 ||
    actions.length > 20 ||
    new Set(actions.map((a) => a?.id)).size !== actions.length ||
    actions.some(
      (a) =>
        !a ||
        typeof a.id !== "string" ||
        !/^[a-zA-Z0-9_-]{1,40}$/.test(a.id) ||
        typeof a.label !== "string" ||
        a.label.length > 120,
    )
  )
    throw new Error("Invalid Jev decision request");
  const criteria = Object.fromEntries(actions.map((a) => [a.id, a.label]));
  try {
    const serializedState = JSON.stringify(state);
    if (!serializedState || serializedState.length > JEV_MAX_STATE_CHARS)
      throw new Error();
    const body = JSON.stringify({
      model,
      state: JSON.parse(serializedState),
      questions: {
        next: {
          type: "choice",
          instructions:
            "Choose the next gameplay action from the allowed options.",
          criteria,
        },
      },
    });
    const requestBytes = new TextEncoder().encode(body).byteLength;
    if (requestBytes > JEV_MAX_REQUEST_BYTES) throw new Error();
    if (typeof beforeDispatch !== "function") throw new Error();
    await beforeDispatch();
    audit?.({ type: "dispatch", model, requestBytes });
    const res = await fetch("https://openrouter.ai/api/v1/systemone", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body,
      signal: AbortSignal.timeout(Math.max(1, Math.min(12000, timeoutMs))),
      redirect: "error",
    });
    if (!res.ok || !res.body) throw new Error();
    const reader = res.body.getReader();
    let size = 0;
    const chunks: Uint8Array[] = [];
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > JEV_MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new Error();
      }
      chunks.push(part.value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    const json = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    );
    if (
      typeof json?.model !== "string" ||
      (json.model !== model &&
        !new RegExp(`^${model.replace(".", "\\.")}[-][0-9]{8}$`).test(
          json.model,
        ))
    )
      throw new Error();
    const selected = json?.answers?.next?.choice;
    if (
      json?.answers?.next?.type !== "choice" ||
      typeof selected !== "string" ||
      !actions.some((a) => a.id === selected)
    )
      throw new Error();
    const tokens = (n: unknown) =>
      typeof n === "number" && Number.isSafeInteger(n) && n >= 0 ? n : null;
    const cost = json?.usage?.cost;
    audit?.({
      type: "response",
      model: json.model,
      responseBytes: size,
      inputTokens: tokens(json?.usage?.input_tokens),
      outputTokens: tokens(json?.usage?.output_tokens),
      cost:
        typeof cost === "number" &&
        Number.isFinite(cost) &&
        cost >= 0 &&
        cost <= 1e9
          ? cost
          : null,
    });
    return selected;
  } catch {
    throw new Error("Jev decision failed or returned an invalid action");
  }
}
