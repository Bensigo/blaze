export const ACTION_COLUMNS = [
  { status: 'open', label: 'To do' },
  { status: 'in_progress', label: 'In progress' },
  { status: 'resolved', label: 'Done' },
] as const;
export type BoardStatus = (typeof ACTION_COLUMNS)[number]['status'];
export function columnForAction(action: {status: string; deferredUntil?: string | null}, now = Date.now()): BoardStatus | null {
  if (action.status === 'open' || action.status === 'in_progress' || action.status === 'resolved') return action.status;
  if (action.status === 'deferred' && action.deferredUntil) {
    const time = Date.parse(action.deferredUntil);
    if (Number.isFinite(time) && time <= now) return 'open';
  }
  return null;
}
