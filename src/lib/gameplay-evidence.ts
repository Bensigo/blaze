import { createHash } from "node:crypto";
import { get, query } from "./db";
import type { Game, Recording, Finding } from "./types";

// Only worker-produced, bounded vocabulary is accepted; game text and model output
// are never used as instructions or copied into findings.
const trace = /^Trace v1: (jev|forced|fixture) selected ([a-zA-Z0-9_-]{1,40}); phase (ready|playing|won|complete|completed|lost|paused|failed|gameover|game_over|unclassified) -> (ready|playing|won|complete|completed|lost|paused|failed|gameover|game_over|unclassified|action_or_run_failed|result_unobserved)\.$/;
const codes = new Set(["lease_failed", "model_request_failed", "adapter_failed", "asset_failed", "timeout", "navigation_failed", "worker_failed"]);

/** Validate trace evidence before storing a worker completion. No cross-game or external links. */
export function validateGameplayEvidence(recording: Recording) {
  const duration = recording.duration;
  if (duration !== undefined && (!Number.isFinite(duration) || duration < 0 || duration > 180)) throw new Error("Invalid gameplay duration");
  const actions = Array.isArray(recording.actions) ? recording.actions : [];
  for (const value of actions) {
    const action = value as { id?: unknown; at?: unknown } | null;
    if (!action || typeof action.id !== "string" || !/^[a-zA-Z0-9_-]{1,40}$/.test(action.id) || typeof action.at !== "number" || !Number.isFinite(action.at) || action.at < 0 || action.at > (duration ?? 180)) throw new Error("Invalid gameplay action");
  }
  for (const note of recording.observations || []) {
    if (!Number.isFinite(note.at) || note.at < 0 || note.at > (duration ?? 180)) throw new Error("Invalid gameplay evidence time");
    if (note.screenshotUrl && note.screenshotUrl !== recording.screenshotUrl) throw new Error("Invalid gameplay screenshot");
    if (!note.text.startsWith("Trace v1:")) continue;
    const match = trace.exec(note.text);
    if (!match || note.type !== "observation" || (recording.mode === "fixture") !== (match[1] === "fixture")) throw new Error("Invalid gameplay trace");
    if (match[4] !== "action_or_run_failed" && !actions.some((a: unknown) => {
      const action = a as { id?: unknown; at?: unknown } | null;
      return action?.id === match[2] && typeof action.at === "number" && Number.isFinite(action.at) && action.at >= note.at && action.at <= (duration ?? 180);
    })) throw new Error("Gameplay trace action missing");
  }
  if (recording.status === "failed" && recording.error && !codes.has(recording.error)) throw new Error("Invalid worker failure code");
}

/** Build stable records before the atomic job completion. */
export function gameplayFindings(recording: Recording): Finding[] {
  validateGameplayEvidence(recording);
  const notes = (recording.observations || []).filter(n => trace.test(n.text)).slice(0, 5);
  if (recording.status === "failed" && recording.error) notes.push({ at: 0, type: "observation", text: `Recording failed with worker code ${recording.error}.` });
  return notes.map(note => {
    const fid = `finding_${createHash("sha256").update(`gameplay:${recording.id}:${note.at}:${note.text}`).digest("hex").slice(0, 24)}`;
    const fixture = recording.mode === "fixture";
    const finding: Finding = { id: fid, gameId: recording.gameId, title: fixture ? "Controlled fixture playthrough" : "Review recorded gameplay", detail: `${fixture ? "Controlled fixture; not live Jev. " : "Synthetic playthrough; not human feedback. "}${note.text} Review the recording and reproduce before classifying a bug.`, type: "observation", priority: "low", evidence: [{ label: fixture ? "Controlled fixture recording" : "Synthetic recording", recordingId: recording.id, at: note.at }], status: "open", createdAt: new Date().toISOString() };
    return finding;
  });
}
/** Insert scoped evidence exactly once without overwriting owner state. */
export async function persistGameplayFindings(workspace: string, recording: Recording) {
  const findings = gameplayFindings(recording);
  const stored = await get<Recording>(workspace, "recording", recording.id);
  const game = await get<Game>(workspace, "game", recording.gameId);
  if (!stored || !game || stored.gameId !== recording.gameId || stored.mode !== recording.mode) throw new Error("Recording does not belong to this game");
  for (const finding of findings) await query(`INSERT INTO records(workspace_id,kind,id,body) VALUES($1,'finding',$2,$3::jsonb) ON CONFLICT DO NOTHING`, [workspace, finding.id, JSON.stringify(finding)]);
}
