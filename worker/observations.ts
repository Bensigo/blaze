export type Observation = {
  at: number;
  text: string;
  type: "observation" | "hypothesis" | "error";
  screenshotUrl?: string;
};
const phases = new Set([
  "ready",
  "playing",
  "won",
  "complete",
  "completed",
  "lost",
  "paused",
  "failed",
  "gameover",
  "game_over",
]);
const errorNames = new Set([
  "Error",
  "TypeError",
  "ReferenceError",
  "RangeError",
  "SyntaxError",
  "URIError",
  "EvalError",
]);
export function safePhase(value: unknown): string {
  return typeof value === "string" && phases.has(value.toLowerCase())
    ? value.toLowerCase()
    : "unclassified";
}
export function safeErrorName(value: unknown): string {
  return typeof value === "string" && errorNames.has(value) ? value : "Error";
}
export function failureCode(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  if (/lease heartbeat/i.test(message)) return "lease_failed";
  if (/Jev/i.test(message)) return "model_request_failed";
  if (/Adapter|action/i.test(message)) return "adapter_failed";
  if (/upload|asset/i.test(message)) return "asset_failed";
  if (/timeout|timed out/i.test(message)) return "timeout";
  if (/network|navigation|page\.goto/i.test(message))
    return "navigation_failed";
  return "worker_failed";
}
export class RunEvidence {
  private start: number;
  private items: Observation[] = [];
  private lastPhase = "";
  private lastState = "";
  private sameState = 0;
  private stuck = false;
  private errorCount = 0;
  private blocked = 0;
  private actionCount = 0;
  private models = 0;
  private completed = false;
  private capturedDuration?: number;
  private pending?: { at: number; source: string; id: string; before: string };
  constructor(start = Date.now()) {
    this.start = start;
  }
  beginCapture() { this.start = Date.now(); this.capturedDuration = undefined; }
  endCapture(duration: number) {
    if (!Number.isFinite(duration) || duration <= 0 || duration > 180) throw new Error("Invalid capture duration");
    this.capturedDuration = duration;
  }
  now() {
    if (this.capturedDuration !== undefined) return this.capturedDuration;
    return Math.max(
      0,
      Math.min(180, Math.round((Date.now() - this.start) / 1000)),
    );
  }
  state(value: unknown, serialized: string) {
    const phase = safePhase((value as { phase?: unknown } | null)?.phase);
    if (this.pending) this.trace(phase);
    if (phase !== this.lastPhase) {
      this.add({
        at: this.now(),
        text: `Observed adapter phase: ${phase}.`,
        type: "observation",
      });
      this.lastPhase = phase;
    }
    this.sameState = serialized === this.lastState ? this.sameState + 1 : 0;
    this.lastState = serialized;
    if (this.sameState >= 8) this.stuck = true;
    if (phase === "won" || phase === "complete" || phase === "completed")
      this.completed = true;
  }
  decision(source: "jev" | "forced" | "fixture", id: string, before: string) {
    this.pending = { at: this.now(), source, id, before: safePhase(before) };
  }
  private trace(result: string) {
    if (!this.pending) return;
    const p = this.pending;
    this.add({ at: p.at, type: "observation", text: `Trace v1: ${p.source} selected ${p.id}; phase ${p.before} -> ${result}.` });
    this.pending = undefined;
  }
  action() {
    this.actionCount++;
  }
  modelDecision() {
    this.models++;
  }
  pageError(name: unknown) {
    this.errorCount++;
    if (this.errorCount <= 5)
      this.add({
        at: this.now(),
        text: `Game page reported ${safeErrorName(name)}.`,
        type: "error",
      });
  }
  blockedRequest() {
    this.blocked++;
  }
  get hasErrors() {
    return this.errorCount > 0;
  }
  private add(item: Observation) {
    if (this.items.length < 30) this.items.push(item);
  }
  finish(options: {
    fixture: boolean;
    screenshotUrl?: string;
    screenshotAt?: number;
    failure?: string;
  }): Observation[] {
    this.trace(options.failure ? "action_or_run_failed" : "result_unobserved");
    const at = this.now(),
      items = this.items.map(item => ({ ...item, at: Math.min(item.at, at) }));
    items.push({
      at,
      text: `Observed ${this.actionCount} actions and ${this.models} Jev model decisions. Final observed phase: ${this.lastPhase || "unobserved"}; completion ${this.completed ? "observed" : "not observed"}.`,
      type: "observation",
    });
    if (options.fixture)
      items.push({
        at,
        text: "Controlled fixture uses deterministic actions and does not validate Jev.",
        type: "observation",
      });
    else if (!this.models)
      items.push({
        at,
        text: "No Jev model decision was made; any executed actions were forced choices.",
        type: "observation",
      });
    if (this.stuck && !this.completed)
      items.push({
        at,
        text: "The adapter state stayed unchanged across at least eight checks; this may indicate a stall. Review the footage.",
        type: "hypothesis",
      });
    if (this.blocked)
      items.push({
        at,
        text: `Worker network policy blocked ${this.blocked} external or disallowed requests. This limits coverage and is not evidence of a game error.`,
        type: "observation",
      });
    if (this.errorCount > 5)
      items.push({
        at,
        text: `${this.errorCount} page errors were observed; only the first five categories are shown.`,
        type: "error",
      });
    if (options.failure)
      items.push({
        at,
        text: `Recording stopped with worker code ${options.failure}.`,
        type: "error",
      });
    if (options.screenshotUrl)
      items.push({
        at: Math.min(options.screenshotAt ?? at, at),
        text: "Final captured frame.",
        type: "observation",
        screenshotUrl: options.screenshotUrl,
      });
    return items;
  }
}
