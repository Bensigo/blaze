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
  const match = <T extends { gameId: string }>(items: T[]) =>
    gameId ? items.filter((x) => x.gameId === gameId) : items;
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
    measurements: await measurementResults(workspace, gameId),
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
