import { transaction, type TransactionQuery } from "./db";
import { HttpError } from "./http-error";

// Archive takes this same parent lock before scanning/cancelling jobs. Holding it
// through enqueue prevents new job rows appearing behind archive's scan.
export function withActiveGameWork<T>(workspace: string, gameId: string, operation: (sql: TransactionQuery) => Promise<T>) {
  return transaction(async sql => {
    const game = await sql(`SELECT id FROM records WHERE workspace_id=$1 AND kind='game' AND id=$2 FOR UPDATE`, [workspace, gameId]);
    if (!game.length) throw new HttpError(404, "Active game not found. Restore the game before queueing work.");
    return operation(sql);
  });
}
