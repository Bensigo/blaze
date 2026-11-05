import type {
  WorkspaceSnapshot,
  Game,
  Recording,
  Clip,
  Post,
  Connection,
  Finding,
  ResearchRun,
} from "./types";
import type { Identity } from "./auth";
import { list, query } from "./db";
import { analytics } from "./analytics";
import { measurementResults } from "./measurements";
import { googleAvailable } from "./neon-auth";
import { socialConfiguration } from "./social-oauth";
import { databaseUsage } from "./db-capacity";
import { mediaStorageConfigured } from "./media";
import { dailyDispatchStatus } from "./daily-dispatch";
export async function snapshot(
  user: Identity,
  gameId?: string,
  days = 14,
): Promise<WorkspaceSnapshot> {
  const workspace = user.workspace_id;
  const [
    games,
    recordings,
    clips,
    posts,
    connections,
    findings,
    runs,
    stats,
    worker,
    google,
    usage,
  ] = await Promise.all([
    list<Game>(workspace, "game"),
    list<Recording>(workspace, "recording"),
    list<Clip>(workspace, "clip"),
    list<Post>(workspace, "post"),
    list<Connection>(workspace, "connection"),
    list<Finding>(workspace, "finding"),
    list<ResearchRun>(workspace, "run"),
    analytics(workspace, gameId, days),
    query<{ updated_at: Date }>(
      `SELECT updated_at FROM jobs WHERE kind='worker_heartbeat' ORDER BY updated_at DESC LIMIT 1`,
    ),
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
    recordings: match(recordings),
    clips: match(clips),
    posts: match(posts),
    connections,
    findings: match(findings),
    runs: match(runs),
    measurements: match(await measurementResults(workspace, gameId)),
    analytics: stats,
    system: {
      database: true,
      databaseUsage: usage,
      google,
      storage: mediaStorageConfigured(),
      worker:
        !!worker[0] &&
        Date.now() - new Date(worker[0].updated_at).getTime() < 90000,
      lastWorkerAt: worker[0]
        ? new Date(worker[0].updated_at).toISOString()
        : undefined,
      dailySchedule:
        process.env.SITE_ID
          ? "Daily analysis at 06:00 UTC. Pending runs remain queued; provider coverage is shown in Run history."
          : "Daily at 06:00 UTC; three games checked per cron invocation, additional queued games need the worker. Approved scheduled posts are checked every minute while the worker runs.",
      dailyDispatch: await dailyDispatchStatus(workspace),
      publishingEnabled: process.env.PUBLISHING_ENABLED === "true",
      social: socialConfiguration(process.env.APP_URL || "http://localhost:3000"),
    },
  };
}
