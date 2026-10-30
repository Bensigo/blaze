import { withActiveGameWork } from "./active-game-work";
import { get, query } from "./db";
import { secretFor } from "./credentials";
import { resolveAISecret } from "./ai-settings";
import { readProfile } from "./game-profile";
import { hash } from "./security";
import type { Clip, Connection, Game, Recording } from "./types";
import type { MediaRecord } from "./media";
import { recordingLimits } from "../../worker/recording-limits";

import {paidJevAllowed,prepareJevReservation,reserveJevValidation,JEV_APPROVAL_REQUIRED} from './jev-budget';
export {paidJevAllowed} from './jev-budget';
import {isControlledLabTarget} from './target-provenance';

const INTERVAL_MIN = 6, INTERVAL_MAX = 24;
export const PAID_JEV_BLOCKED = JEV_APPROVAL_REQUIRED;
type Config = { id: string; enabled: boolean; intervalHours: number };
type Gate = { id: string; active?: string; lastQueuedAt?: string };
const defaultConfig = (gameId: string): Config => ({ id: gameId, enabled: true, intervalHours: 24 });
export const actualJev = (recording: Recording) => recording.targetProvenance !== "controlled_lab" && recording.status === "ready" && recording.mode === "jev" && !!recording.videoUrl && Number(recording.duration) > 0 && Array.isArray(recording.actions) && recording.actions.some(a => typeof a === "object" && a !== null && "id" in a && typeof a.id === "string" && /^[a-zA-Z0-9_-]{1,40}$/.test(a.id) && "at" in a && typeof a.at === "number" && a.at >= 0 && a.at <= recording.duration!) && (recording.observations || []).some(o => o.type === "observation" && /\b[1-9]\d* Jev model decisions\b/.test(o.text));
export async function hasRecordingAsset(workspace: string, recording: Recording) {
  const mediaId = /^\/api\/media\/(media_[a-z0-9]+)$/.exec(recording.videoUrl || "")?.[1];
  const media = mediaId ? await get<MediaRecord>(workspace, "media", mediaId) : undefined;
  return !!media && media.recordingId === recording.id && media.kind === "video" && !media.clipId;
}

export async function automationState(workspace: string, gameId: string) {
  const [configRecord, gate, profile, worker, connections, recordings, jevSelection] = await Promise.all([
    get<Config>(workspace, "game_automation", gameId), get<Gate>(workspace, "recording_gate", gameId), readProfile(workspace, gameId),
    query<{ updated_at: Date }>(`SELECT updated_at FROM jobs WHERE id='worker-runtime' AND kind='worker_heartbeat'`),
    query<{ body: Connection }>(`SELECT body FROM records WHERE workspace_id=$1 AND kind='connection' AND body->>'provider'='jev' ORDER BY updated_at DESC`, [workspace]),
    query<{ body: Recording }>(`SELECT body FROM records WHERE workspace_id=$1 AND kind='recording' AND body->>'gameId'=$2 AND body->>'status'='ready' AND body->>'mode'='jev' ORDER BY updated_at DESC LIMIT 30`, [workspace, gameId]),
    get<{ id: string; connectionId: string }>(workspace, "jev_settings", "default"),
  ]);
  const config = configRecord || defaultConfig(gameId);
  const jevSecret = await secretFor(workspace, "jev").catch(() => undefined);
  // Historical saved verification only: current provider availability is checked on generation.
  const aiSecret = await resolveAISecret(workspace, false).catch(() => undefined);
  const reasons: string[] = [];
  reasons.push("Recurring background play needs separate approval; a single validation approval does not authorize recurring usage.");
  if (!config.enabled) reasons.push("Automatic recording is paused.");
  if (!jevSecret?.token || !jevSecret.model) reasons.push("Connect and verify a Jev key.");
  if (!worker[0] || Date.now() - new Date(worker[0].updated_at).getTime() > 90000) reasons.push("A fresh browser worker heartbeat is required.");
  if (!["partial", "complete"].includes(profile.status) || !profile.lastRefresh) reasons.push("Complete the initial game investigation.");
  const actualRuns = recordings.filter(r => actualJev(r.body));
  const hasEvidence = (await Promise.all(actualRuns.map(r => hasRecordingAsset(workspace, r.body)))).some(Boolean);
  if (!hasEvidence) reasons.push("First run this same game successfully in Jev mode with real actions and a model decision; a page URL or fixture alone does not establish adapter readiness.");
  const active = (await query<{ id: string }>(`SELECT j.id FROM jobs j JOIN records r ON r.workspace_id=j.workspace_id AND r.id=j.id AND r.kind='recording' WHERE j.workspace_id=$1 AND j.kind='recording' AND j.state IN ('queued','claimed') AND r.body->>'gameId'=$2 LIMIT 1`, [workspace, gameId]))[0];
  const lastQueuedAt = gate?.lastQueuedAt || null;
  const due = lastQueuedAt ? new Date(new Date(lastQueuedAt).getTime() + config.intervalHours * 3600000).toISOString() : null;
  const draftReasons = aiSecret?.token && aiSecret.model ? [] : ["Choose an AI provider and model in Account settings for optional draft generation."];
  return { gameId, enabled: config.enabled, intervalHours: config.intervalHours, ready: reasons.length === 0, adapterVerified: hasEvidence, reasons, draftReady: draftReasons.length === 0, draftReasons, lastQueuedAt, activeRecordingId: active?.id || null, nextDueAt: due };
}

export async function setAutomationConfig(workspace: string, gameId: string, patch: { enabled?: boolean; intervalHours?: number }) {
  // Merge only submitted keys so concurrent edits to distinct settings survive.
  const set = Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined));
  await query(`WITH gate AS (INSERT INTO records(workspace_id,kind,id,body) VALUES($1,'recording_gate',$2,jsonb_build_object('id',$2::text) || $4::jsonb) ON CONFLICT(workspace_id,kind,id) DO UPDATE SET body=records.body || $4::jsonb,updated_at=now() RETURNING id) INSERT INTO records(workspace_id,kind,id,body) SELECT $1,'game_automation',$2,$3::jsonb || $4::jsonb FROM gate ON CONFLICT(workspace_id,kind,id) DO UPDATE SET body=records.body || $4::jsonb,updated_at=now()`, [workspace, gameId, JSON.stringify(defaultConfig(gameId)), JSON.stringify(set)]);
}

// A gate is held until completion/lease failure. All newly queued recordings use it.
export async function enqueueRecording(workspace: string, recording: Recording, scheduled = false, intervalHours = 24) {
  recordingLimits(recording);
  if (intervalHours < INTERVAL_MIN || intervalHours > INTERVAL_MAX) throw new Error("Invalid recording interval");
  let reservation: Awaited<ReturnType<typeof prepareJevReservation>> | undefined;
  if (recording.mode === "jev") {
    if (!await paidJevAllowed(workspace,recording)) throw new Error(PAID_JEV_BLOCKED);
    reservation=await prepareJevReservation(workspace,recording);
    const secret = await secretFor(workspace, "jev");
    if (!secret?.token || typeof secret.model !== "string" || typeof secret.jevConnectionId !== "string" || typeof secret.jevSettingsRevision !== "string" || typeof secret.jevCredentialVersion !== "string") throw new Error("Configure Jev gameplay in Account settings before queueing.");
    recording.jevSelection = {connectionId: secret.jevConnectionId, model: secret.model, settingsRevision: secret.jevSettingsRevision, credentialVersion: secret.jevCredentialVersion};
  }
  const game = await get<Game>(workspace,"game",recording.gameId);
  if (game && isControlledLabTarget(game.url,process.env.APP_URL)) recording.targetProvenance="controlled_lab";
  const stamp = new Date().toISOString();
  const gate = { id: recording.gameId, active: recording.id, ...(scheduled ? { lastQueuedAt: stamp } : {}) };
  return withActiveGameWork(workspace, recording.gameId, async tx=>{
  if(reservation)await reserveJevValidation(tx,workspace,recording,reservation.grant);
  const inserted = await tx<{ id: string }>(`WITH gate AS (
    INSERT INTO records(workspace_id,kind,id,body)
    SELECT $1,'recording_gate',$2,$3::jsonb WHERE NOT EXISTS (
      SELECT 1 FROM records r JOIN jobs j ON j.id=r.id AND j.workspace_id=r.workspace_id
      WHERE r.workspace_id=$1 AND r.kind='recording' AND r.body->>'gameId'=$2 AND j.kind='recording' AND j.state IN ('queued','claimed'))
    ON CONFLICT(workspace_id,kind,id) DO UPDATE SET body=records.body || $3::jsonb,updated_at=now()
    WHERE records.body->>'active' IS NULL AND ($4::boolean=false OR (coalesce((records.body->>'enabled')::boolean,true) AND (records.body->>'lastQueuedAt' IS NULL OR (records.body->>'lastQueuedAt')::timestamptz <= now()-(coalesce(records.body->>'intervalHours',$5::text)||' hours')::interval)))
    RETURNING id
  ), created AS (INSERT INTO records(workspace_id,kind,id,body) SELECT $1,'recording',$6,$7::jsonb FROM gate RETURNING id)
  INSERT INTO jobs(id,workspace_id,kind,state,body) SELECT id,$1,'recording','queued',$7::jsonb FROM created RETURNING id`,
    [workspace, recording.gameId, JSON.stringify(gate), scheduled, String(intervalHours), recording.id, JSON.stringify(recording)]);
  if(reservation&&!inserted.length)throw new Error("A recording is already active; approval reservation rolled back.");
  return inserted.length > 0;
  });
}
export async function releaseRecordingGate(workspace: string, gameId: string, recordingId: string) {
  await query(`UPDATE records SET body=body-'active',updated_at=now() WHERE workspace_id=$1 AND kind='recording_gate' AND id=$2 AND body->>'active'=$3`, [workspace, gameId, recordingId]);
}
export async function queueScheduledRecording(workspace: string, game: Game) {
  const state = await automationState(workspace, game.id);
  if (!state.ready || state.activeRecordingId || (state.nextDueAt && Date.parse(state.nextDueAt) > Date.now())) return { queued: false, ...state };
  const bucket = Math.floor(Date.now() / (state.intervalHours * 3600000));
  const recording: Recording = { id: `rec_${hash(`${workspace}:${game.id}:${state.intervalHours}:${bucket}`).slice(0,32)}`, gameId: game.id, title: `${game.title} · scheduled Jev run`, status: "queued", mode: "jev", createdAt: new Date().toISOString() };
  try { return { queued: await enqueueRecording(workspace, recording, true, state.intervalHours), ...state }; }
  catch (error) {
    // A deterministic job already queued in this bucket is an expected duplicate, not a new run.
    if ((await query(`SELECT id FROM jobs WHERE id=$1 AND workspace_id=$2`, [recording.id, workspace])).length) return { queued: false, ...state };
    throw error;
  }
}

export async function queueClipCandidate(workspace: string, recording: Recording, title: string) {
  if (!actualJev(recording) || !recording.duration || !await hasRecordingAsset(workspace, recording)) return false;
  const duration = Math.min(180, recording.duration);
  const firstAction = recording.actions?.find((action): action is { at: number; id: string } =>
    typeof action === "object" && action !== null && "at" in action && typeof action.at === "number" && action.at >= 0 && action.at < duration && "id" in action && typeof action.id === "string" && /^[a-zA-Z0-9_-]{1,40}$/.test(action.id));
  const observed = recording.observations?.find(o => o.type === "observation" && o.at >= 3 && o.at < duration);
  const start = firstAction ? Math.max(0, Math.floor(firstAction.at - 1)) : observed ? Math.max(0, Math.floor(observed.at - 5)) : 0;
  const end = Math.min(duration, start + 20);
  if (end <= start) return false;
  const clip: Clip = { id: `clip_${hash(`${workspace}:${recording.id}:candidate`).slice(0,32)}`, gameId: recording.gameId, recordingId: recording.id, title: `${title.slice(0,100)} · gameplay candidate`, start, end, layout: "landscape", status: "queued", createdAt: new Date().toISOString() };
  const rows = await withActiveGameWork(workspace, recording.gameId, sql => sql(`WITH created AS (INSERT INTO records(workspace_id,kind,id,body) VALUES($1,'clip',$2,$3::jsonb) ON CONFLICT DO NOTHING RETURNING id) INSERT INTO jobs(id,workspace_id,kind,state,body) SELECT id,$1,'clip','queued',$3::jsonb FROM created ON CONFLICT DO NOTHING RETURNING id`, [workspace, clip.id, JSON.stringify(clip)]));
  return rows.length > 0;
}

type RecoveryPosition = { updatedAt: string; id: string; until?: string };
type RecoveryCursor = { id: string; recording?: RecoveryPosition; clip?: RecoveryPosition };
type RecoveryRow<T> = { id: string; body: T; cursor_time: string };
const RECOVERY_BATCH = 10;

// Scan oldest first using a per-game cursor. After the last page, wrap so records
// skipped for missing credentials or assets are revisited when prerequisites change.
// Preserve microseconds: JavaScript Date truncation can otherwise repeat a page.
async function recoveryPage<T>(workspace: string, gameId: string, kind: "recording" | "clip", until: string, cursor?: RecoveryPosition): Promise<RecoveryRow<T>[]> {
  return query<RecoveryRow<T>>(`SELECT id,body,to_char(updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_time FROM records
    WHERE workspace_id=$1 AND kind=$2 AND body->>'gameId'=$3 AND body->>'status'='ready'
      AND ($2::text <> 'recording' OR body->>'mode'='jev')
      AND ($4::timestamptz IS NULL OR (updated_at,id)>($4::timestamptz,$5::text)) AND updated_at <= $7::timestamptz
    ORDER BY updated_at,id LIMIT $6`, [workspace, kind, gameId, cursor?.updatedAt || null, cursor?.id || "", RECOVERY_BATCH, until]);
}
function nextRecoveryPosition<T>(rows: RecoveryRow<T>[], until: string): RecoveryPosition | undefined {
  const last = rows.at(-1);
  return rows.length === RECOVERY_BATCH && last ? { updatedAt: last.cursor_time, id: last.id, until } : undefined;
}
export async function recoverGameContent(workspace: string, game: Game) {
  const previous = await get<RecoveryCursor>(workspace, "automation_recovery", game.id);
  // A fixed cycle boundary guarantees wrap even while new items keep arriving.
  const watermark = (await query<{ watermark: string }>(`SELECT to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS watermark`))[0].watermark;
  const recordingUntil = previous?.recording?.until || watermark;
  const clipUntil = previous?.clip?.until || watermark;
  const recordings = await recoveryPage<Recording>(workspace, game.id, "recording", recordingUntil, previous?.recording);
  for (const { body } of recordings) {
    try { await queueClipCandidate(workspace, body, game.title); }
    catch (error) { console.error("Automatic recording recovery failed", error instanceof Error ? error.name : "UnknownError"); }
  }
  const clips = await recoveryPage<Clip>(workspace, game.id, "clip", clipUntil, previous?.clip);
  const { queueClipDraft } = await import("./content-automation");
  for (const { body } of clips) {
    try { await queueClipDraft(workspace, body); }
    catch (error) { console.error("Automatic clip recovery failed", error instanceof Error ? error.name : "UnknownError"); }
  }
  const cursor: RecoveryCursor = { id: game.id, recording: nextRecoveryPosition(recordings, recordingUntil), clip: nextRecoveryPosition(clips, clipUntil) };
  await query(`INSERT INTO records(workspace_id,kind,id,body) VALUES($1,'automation_recovery',$2,$3::jsonb) ON CONFLICT(workspace_id,kind,id) DO UPDATE SET body=excluded.body,updated_at=now()`, [workspace, game.id, JSON.stringify(cursor)]);
}

// Limit each scheduler tick and move a durable cursor so large catalogues are not starved.
export async function tickAutomation() {
  const tick = (await query<{ body: { workspace?: string; gameId?: string }; lease_until: Date }>(`INSERT INTO jobs(id,workspace_id,kind,state,body,lease_until) VALUES('automation-tick','system','scheduler','running','{}',now()+interval '2 minutes') ON CONFLICT(id) DO UPDATE SET lease_until=excluded.lease_until,updated_at=now() WHERE jobs.lease_until<now() RETURNING body,lease_until`))[0];
  if (!tick) return;
  await query(`UPDATE records g SET body=g.body-'active',updated_at=now() FROM jobs j WHERE g.kind='recording_gate' AND j.workspace_id=g.workspace_id AND j.id=g.body->>'active' AND j.kind='recording' AND j.state IN ('complete','failed')`);
  const rows = await query<{ workspace_id: string; body: Game }>(`SELECT workspace_id,body FROM records WHERE kind='game' AND (workspace_id,id)>($1,$2) ORDER BY workspace_id,id LIMIT 5`, [tick.body.workspace || "", tick.body.gameId || ""]);
  for (const row of rows) {
    try {
      await queueScheduledRecording(row.workspace_id, row.body);
      // Recover completed work even if its completion callback was interrupted.
      await recoverGameContent(row.workspace_id, row.body);
    } catch (error) {
      console.error("Automatic game processing failed", error instanceof Error ? error.name : "UnknownError");
    }
  }
  const last = rows.at(-1);
  await query(`UPDATE jobs SET body=$1::jsonb WHERE id='automation-tick' AND lease_until=$2::timestamptz`, [JSON.stringify(last ? { workspace: last.workspace_id, gameId: last.body.id } : {}), tick.lease_until]);
}
