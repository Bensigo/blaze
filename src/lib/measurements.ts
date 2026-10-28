import { query, list } from "./db";
import { summarize, type EventRow } from "./analytics";
import type { Measurement } from "./types";
export async function measurementResults(workspace: string, gameId?: string) {
  const measurements = (
    await list<Measurement>(workspace, "measurement")
  ).filter((m) => !gameId || m.gameId === gameId);
  return Promise.all(
    measurements.map(async (m) => {
      const events = await query<EventRow>(
        `SELECT * FROM events WHERE workspace_id=$1 AND game_id=$2 AND kind='human' AND occurred_at>=$3 AND occurred_at<$3::timestamptz+interval '14 days'`,
        [workspace, m.gameId, m.startedAt],
      );
      const end = Math.min(
        Date.now(),
        new Date(m.startedAt).getTime() + 14 * 86400000,
      );
      const a = summarize(events, new Map(), 14, end);
      return {
        ...m,
        after: {
          sessions: a.sessions,
          starts: a.starts,
          completions: a.completions,
          errorSessions: a.errorSessions,
        },
        daysObserved: Math.min(
          14,
          (Date.now() - new Date(m.startedAt).getTime()) / 86400000,
        ),
      };
    }),
  );
}
