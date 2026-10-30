import { list, transaction } from "./db";
import { HttpError } from "./http-error";
import type { Game } from "./types";
export type ArchivedGame = { id: string; game: Game; deletedAt: string; deletedBy: string };
export async function archivedGames(workspace: string) { return list<ArchivedGame>(workspace, "archived_game"); }
export async function archiveGame(workspace: string, gameId: string, confirmation: string, actor: string) {
  return transaction(async sql => {
    const game = (await sql<{ body: Game }>(`SELECT body FROM records WHERE workspace_id=$1 AND kind='game' AND id=$2 FOR UPDATE`, [workspace, gameId]))[0]?.body;
    if (!game) {
      const archived = (await sql<{ body: ArchivedGame }>(`SELECT body FROM records WHERE workspace_id=$1 AND kind='archived_game' AND id=$2`, [workspace, gameId]))[0]?.body;
      if (archived && archived.game.title === confirmation) return archived;
      throw new HttpError(404, "Game not found.");
    }
    if (confirmation !== game.title) throw new HttpError(400, "Type the game's exact name to confirm deletion.");
    await sql(`SELECT id FROM records WHERE workspace_id=$1 AND kind='post' AND body->>'gameId'=$2 FOR UPDATE`, [workspace, gameId]);
    // claimJob locks these same rows with SKIP LOCKED. Existing queued work cannot
    // become claimed between our check and cancellation, including post-linked jobs.
    await sql(`SELECT id FROM jobs WHERE workspace_id=$1 AND (body->>'gameId'=$2 OR body->>'postId' IN (SELECT id FROM records WHERE workspace_id=$1 AND kind='post' AND body->>'gameId'=$2)) FOR UPDATE`, [workspace, gameId]);
    const active = await sql(`SELECT id FROM records WHERE workspace_id=$1 AND body->>'gameId'=$2 AND ((kind='video_production' AND body->>'state' IN ('starting','running','importing','cancel_requested','needs_reconciliation')) OR (kind='recording' AND body->>'status'='recording') OR (kind='idea_batch' AND body->>'state' IN ('starting','scoring','needs_reconciliation')) OR (kind='on_demand_content' AND body->>'state' IN ('starting','scoring','needs_reconciliation')) OR (kind='script_review' AND body->>'state' IN ('starting','needs_reconciliation')) OR (kind='post' AND body->>'status' IN ('uploading','processing'))) LIMIT 1`, [workspace, gameId]);
    const claimed = await sql(`SELECT id FROM jobs WHERE workspace_id=$1 AND state='claimed' AND (body->>'gameId'=$2 OR body->>'postId' IN (SELECT id FROM records WHERE workspace_id=$1 AND kind='post' AND body->>'gameId'=$2)) LIMIT 1`, [workspace, gameId]);
    if (active.length || claimed.length) throw new HttpError(409, "This game has active or uncertain work. Stop or reconcile its runs before deleting it. No data was removed.");
    const archived: ArchivedGame = { id: game.id, game, deletedAt: new Date().toISOString(), deletedBy: actor };
    await sql(`INSERT INTO records(workspace_id,kind,id,body) VALUES($1,'archived_game',$2,$3::jsonb) ON CONFLICT(workspace_id,kind,id) DO UPDATE SET body=excluded.body,updated_at=now()`, [workspace, gameId, JSON.stringify(archived)]);
    await sql(`UPDATE jobs SET state='failed',body=body || '{"error":"Game removed from active dashboard. Restore and approve new work to continue."}'::jsonb,updated_at=now() WHERE workspace_id=$1 AND state='queued' AND (body->>'gameId'=$2 OR body->>'postId' IN (SELECT id FROM records WHERE workspace_id=$1 AND kind='post' AND body->>'gameId'=$2))`, [workspace, gameId]);
    await sql(`UPDATE records SET body=(body-'approvedHash'-'approvedAt'-'approvedBy') || '{"status":"draft","deliveryMethod":"manual"}'::jsonb,updated_at=now() WHERE workspace_id=$1 AND kind='post' AND body->>'gameId'=$2 AND body->>'status' IN ('approved','scheduled')`, [workspace, gameId]);
    await sql(`INSERT INTO records(workspace_id,kind,id,body) VALUES($1,'game_automation',$2,jsonb_build_object('id',$2::text,'enabled',false,'intervalHours',24)) ON CONFLICT(workspace_id,kind,id) DO UPDATE SET body=records.body || '{"enabled":false}'::jsonb,updated_at=now()`, [workspace, gameId]);
    await sql(`UPDATE records SET body=body-'active',updated_at=now() WHERE workspace_id=$1 AND kind='recording_gate' AND id=$2`, [workspace, gameId]);
    await sql(`UPDATE records SET body=body || '{"state":"cancelled","error":"Game removed from active dashboard; approval consumed."}'::jsonb,updated_at=now() WHERE workspace_id=$1 AND kind='video_production' AND body->>'gameId'=$2 AND body->>'state'='approved'`, [workspace, gameId]);
    await sql(`UPDATE records SET body=body || '{"status":"failed","error":"Game removed from active dashboard."}'::jsonb,updated_at=now() WHERE workspace_id=$1 AND kind IN ('recording','clip') AND body->>'gameId'=$2 AND body->>'status'='queued'`, [workspace, gameId]);
    await sql(`UPDATE records SET body=body || '{"state":"failed","error":"Game removed; script review approval consumed."}'::jsonb,updated_at=now() WHERE workspace_id=$1 AND kind='script_review' AND body->>'gameId'=$2 AND body->>'state'='approved'`, [workspace, gameId]);
    await sql(`UPDATE records SET body=body || '{"state":"failed","error":"Game removed; unused content generation approval consumed."}'::jsonb,updated_at=now() WHERE workspace_id=$1 AND kind='on_demand_content' AND body->>'gameId'=$2 AND body->>'state'='approved'`,[workspace,gameId]);
    // Retain events, content, media, profiles and identifiers. Restore never requeues cancelled paid work.
    await sql(`DELETE FROM records WHERE workspace_id=$1 AND kind='game' AND id=$2`, [workspace, gameId]);
    return archived;
  });
}
export async function restoreGame(workspace: string, gameId: string) {
  return transaction(async sql => {
    const archived = (await sql<{ body: ArchivedGame }>(`SELECT body FROM records WHERE workspace_id=$1 AND kind='archived_game' AND id=$2 FOR UPDATE`, [workspace, gameId]))[0]?.body;
    if (!archived) {
      const active = (await sql<{ body: Game }>(`SELECT body FROM records WHERE workspace_id=$1 AND kind='game' AND id=$2`, [workspace, gameId]))[0]?.body;
      if (active) return active;
      throw new HttpError(404, "Deleted game not found.");
    }
    // Daily automation remains paused after restore; explicitly re-enable only through its normal controls.
    const game = { ...archived.game, dailyEnabled: false };
    await sql(`INSERT INTO records(workspace_id,kind,id,body) VALUES($1,'game',$2,$3::jsonb) ON CONFLICT DO NOTHING`, [workspace, gameId, JSON.stringify(game)]);
    await sql(`DELETE FROM records WHERE workspace_id=$1 AND kind='archived_game' AND id=$2`, [workspace, gameId]);
    return game;
  });
}
