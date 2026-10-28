import type {
  WorkspaceSnapshot,
  Game,
  Recording,
  Clip,
  Post,
  Connection,
  Finding,
  ResearchRun,
  SessionCapture,
} from "./types";
import type { Identity } from "./auth";
import { list, query } from "./db";
import { analytics } from "./analytics";
import { measurementResults } from "./measurements";
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
  ]);
  const match = <T extends { gameId: string }>(items: T[]) =>
    gameId ? items.filter((x) => x.gameId === gameId) : items;
  const captures = await list<SessionCapture>(workspace, "session_capture");
  stats.sessionsList = stats.sessionsList.map((session) => {
    const capture = captures.find(
      (c) => c.gameId === session.gameId && c.sessionId === session.id,
    );
    return {
      ...session,
      captureId: capture?.id,
      captureStatus:
        capture && Date.parse(capture.expiresAt) <= Date.now()
          ? "expired"
          : capture?.status,
    };
  });
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
      google: !!(
        process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
      ),
      storage: !!process.env.BLOB_READ_WRITE_TOKEN || !process.env.VERCEL,
      worker:
        !!worker[0] &&
        Date.now() - new Date(worker[0].updated_at).getTime() < 90000,
      lastWorkerAt: worker[0]
        ? new Date(worker[0].updated_at).toISOString()
        : undefined,
      dailySchedule:
        "Daily at 06:00 UTC; three games checked per cron invocation, additional queued games need the worker. Approved scheduled posts are checked every minute while the worker runs.",
      publishingEnabled: process.env.PUBLISHING_ENABLED === "true",
    },
  };
}
