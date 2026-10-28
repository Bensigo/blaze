import { safePhase } from "./observations";
export type AdapterAction = { id: string; label: string };
export function validateAdapterSnapshot(state: unknown, input: unknown) {
  const phase = safePhase((state as { phase?: unknown } | null)?.phase);
  const terminal = ["won", "complete", "completed", "lost", "gameover", "game_over", "failed"].includes(phase);
  if (!Array.isArray(input) || input.length > 20 || (!terminal && input.length < 1)) throw new Error("Adapter actions must contain 1–20 choices while play is active");
  const actions: AdapterAction[] = input.map((a) => ({ id: a?.id, label: a?.label }));
  if (actions.some(a => typeof a.id !== "string" || !/^[a-zA-Z0-9_-]{1,40}$/.test(a.id) || typeof a.label !== "string" || a.label.length > 120) || new Set(actions.map(a => a.id)).size !== actions.length) throw new Error("Adapter actions invalid");
  return { phase, terminal, actions };
}
