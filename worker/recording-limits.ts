/** Explicit per-run limits. Never coerce strings or silently widen invalid limits. */
export const BOUNDED_WORKER_PROTOCOL = 'jev-actions-v1';
export function workerProtocol(value: string | null | undefined) {
  return value === BOUNDED_WORKER_PROTOCOL ? BOUNDED_WORKER_PROTOCOL : 'legacy';
}
export function recordingLimits(input: unknown) {
  if (!input || typeof input !== 'object') throw new Error('Invalid recording limits.');
  const value = input as { maxActions?: unknown; maxDurationSeconds?: unknown };
  const maxActions = value.maxActions === undefined ? 30 : value.maxActions;
  const maxDurationSeconds = value.maxDurationSeconds === undefined ? 30 : value.maxDurationSeconds;
  if (typeof maxActions !== 'number' || !Number.isInteger(maxActions) || maxActions < 1 || maxActions > 30 || typeof maxDurationSeconds !== 'number' || !Number.isInteger(maxDurationSeconds) || maxDurationSeconds < 1 || maxDurationSeconds > 30) throw new Error('Recording limits must be whole numbers between 1 and 30.');
  return { maxActions, maxDurationSeconds };
}

export class RecordingBudget {
  private actions = 0;
  constructor(private limits: ReturnType<typeof recordingLimits>, private started: number, private clock = Date.now) {}
  remaining() { return this.limits.maxDurationSeconds * 1000 - (this.clock() - this.started); }
  canObserve() { return this.remaining() > 0; }
  canAct() { return this.actions < this.limits.maxActions && this.remaining() > 0; }
  acted() { this.actions++; }
}
