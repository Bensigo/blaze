import { query } from './db';
import { HttpError } from './http-error';
import type { Finding } from './types';

const ownerFields = ['status', 'createdAt', 'resolvedAt', 'deferredUntil', 'decisionNote', 'updatedAt'];
const statuses = new Set<Finding['status']>(['open', 'in_progress', 'deferred', 'dismissed', 'resolved']);

/** Refresh generated content atomically, retaining any existing owner decision. */
export async function upsertResearchFinding(workspace: string, finding: Finding, options: {openOnly?:boolean} = {}): Promise<Finding> {
  const rows = await query<{ body: Finding }>(`INSERT INTO records(workspace_id,kind,id,body)
    VALUES($1,'finding',$2,$3::jsonb)
    ON CONFLICT(workspace_id,kind,id) DO UPDATE SET
      body=CASE WHEN $5::boolean AND records.body->>'status'<>'open' THEN records.body ELSE (excluded.body - $4::text[]) || coalesce((
        SELECT jsonb_object_agg(key,value) FROM jsonb_each(records.body) WHERE key=ANY($4::text[])
      ), '{}'::jsonb) END, updated_at=now()
    WHERE records.body->>'gameId'=excluded.body->>'gameId'
    RETURNING body`, [workspace, finding.id, JSON.stringify(finding), ownerFields,!!options.openOnly]);
  if (!rows.length) throw new HttpError(409, 'Finding belongs to a different game.');
  return rows[0].body;
}

type Decision = { status: Finding['status']; note?: string; deferredUntil?: string };
/** Change the note independently of concurrent status and research updates. */
export async function saveFindingNote(workspace: string, id: string, note: string, now = new Date(), gameId?: string): Promise<Finding> {
  if (typeof note !== 'string' || note.length > 500) throw new HttpError(400, 'Decision note must be at most 500 characters.');
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw new HttpError(400, 'Invalid decision time.');
  const trimmed = note.trim();
  const patch = { updatedAt: now.toISOString(), ...(trimmed ? { decisionNote: trimmed } : {}) };
  const rows = await query<{ body: Finding }>(`UPDATE records SET body=(body - 'decisionNote') || $3::jsonb, updated_at=now()
    WHERE workspace_id=$1 AND kind='finding' AND id=$2 AND ($4::text IS NULL OR body->>'gameId'=$4) RETURNING body`, [workspace, id, JSON.stringify(patch), gameId ?? null]);
  if (!rows.length) throw new HttpError(404, 'Finding not found.');
  return rows[0].body;
}
/** Patch only decision fields so concurrent research cannot erase an owner decision. */
export async function setFindingDecision(workspace: string, id: string, decision: Decision, now = new Date()): Promise<Finding> {
  if (!decision || !statuses.has(decision.status)) throw new HttpError(400, 'Invalid finding status.');
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw new HttpError(400, 'Invalid decision time.');
  if (decision.note !== undefined && (typeof decision.note !== 'string' || decision.note.length > 500)) throw new HttpError(400, 'Decision note must be at most 500 characters.');
  let deferredUntil: string | undefined;
  if (decision.status === 'deferred') {
    const time = typeof decision.deferredUntil === 'string' ? Date.parse(decision.deferredUntil) : NaN;
    if (!Number.isFinite(time) || time <= now.getTime() || time > now.getTime() + 366 * 86400000) throw new HttpError(400, 'Choose a future deferral date within 366 days.');
    deferredUntil = new Date(time).toISOString();
  } else if (decision.deferredUntil !== undefined) throw new HttpError(400, 'A deferral date requires deferred status.');
  const stamp = now.toISOString();
  const patch: Record<string, string> = { status: decision.status, updatedAt: stamp };
  if (decision.status === 'resolved') patch.resolvedAt = stamp;
  if (deferredUntil) patch.deferredUntil = deferredUntil;
  if (decision.note?.trim()) patch.decisionNote = decision.note.trim();
  const remove = ['resolvedAt', 'deferredUntil'];
  if (decision.note !== undefined) remove.push('decisionNote');
  const rows = await query<{ body: Finding }>(`UPDATE records SET body=(body - $3::text[]) || $4::jsonb, updated_at=now()
    WHERE workspace_id=$1 AND kind='finding' AND id=$2 RETURNING body`, [workspace, id, remove, JSON.stringify(patch)]);
  if (!rows.length) throw new HttpError(404, 'Finding not found.');
  return rows[0].body;
}
