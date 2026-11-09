import type {
  WorkspaceSnapshot,
  Game,
  Connection,
  Finding,
} from "./types";
import type { Identity } from "./auth";
import { list, query } from "./db";
import { analytics } from "./analytics";
import { measurementResults } from "./measurements";
import { googleAvailable } from "./neon-auth";
import { databaseUsage } from "./db-capacity";
import { retentionDays } from "./maintenance";
import { mediaStorageConfigured } from "./media";
export async function snapshot(
  user: Identity,
  gameId?: string,
  days = 14,
): Promise<WorkspaceSnapshot> {
  const workspace = user.workspace_id;
  let eventRetentionDays: number | null = null;
  try { eventRetentionDays = retentionDays(); } catch { /* Maintenance status exposes invalid configuration. */ }
  const [
    games,
    connections,
    findings,
    stats,
    google,
    usage,
  ] = await Promise.all([
    list<Game>(workspace, "game"),
    list<Connection>(workspace, "connection").then(items => items.filter(item => item.provider === "search_console")),
    list<Finding>(workspace, "finding"),
    analytics(workspace, gameId, days),
    googleAvailable(),
    databaseUsage(),
  ]);
  const eventCoverage=await query<{game_id:string;events:number;last_at:string}>(`SELECT game_id,count(*)::int events,max(occurred_at)::text last_at FROM events e WHERE workspace_id=$1 AND kind='human' AND occurred_at>=now()-interval '14 days' AND occurred_at<=now() AND NOT EXISTS(SELECT 1 FROM events t WHERE t.workspace_id=e.workspace_id AND t.game_id=e.game_id AND t.session_id=e.session_id AND (t.kind='agent' OR t.properties @> '{"test":true}' OR t.properties @> '{"fixture":true}')) GROUP BY game_id`,[workspace]);
  for(const game of games){const coverage=eventCoverage.find(row=>row.game_id===game.id);game.telemetry={humanEvents:coverage?Number(coverage.events):0,lastEventAt:coverage?new Date(coverage.last_at).toISOString():null};}
  const activeGames = new Set(games.map(game => game.id));
  const match = <T extends { gameId: string }>(items: T[]) =>
    items.filter((x) => activeGames.has(x.gameId) && (!gameId || x.gameId === gameId));
  return {
    user: { name: user.name, email: user.email },
    workspace: { id: workspace, name: "Your workspace" },
    demo: false,
    games,
    recordings: [],
    clips: [],
    posts: [],
    connections,
    findings: match(findings),
    runs: [],
    measurements: match(await measurementResults(workspace, gameId)),
    analytics: stats,
    system: {
      database: true,
      eventRetentionDays,
      databaseUsage: usage,
      google,
      storage: mediaStorageConfigured(),
      worker: false,
      dailySchedule: "Capture retention cleanup runs daily.",
      publishingEnabled: false,

    },
  };
}
