import { bearer } from "@/lib/security";
import { queueDailyResearch, drainResearch } from "@/lib/research-jobs";
import { duePublications } from "@/lib/publishing";
import { query } from "@/lib/db";
import { cleanupCaptures } from "@/lib/session-capture";
import { drainProfile, queueHumanProfileRefresh } from "@/lib/game-profile";
import { tickAutomation } from "@/lib/game-automation";
import { drainContentAutomation } from "@/lib/content-automation";
export const maxDuration = 60;
export async function GET(request: Request) {
  if (!bearer(request, "CRON_SECRET"))
    return new Response(null, { status: 401 });
  await query(`DELETE FROM rate_windows WHERE expires_at<now()`);
  await query(`DELETE FROM auth_sessions WHERE expires_at<now()`);
  const captureCleanup = await cleanupCaptures();
  let profileRecovered = 0;
  if (process.env.APP_URL) {
    const games = await query<{workspace_id: string; id: string}>(`SELECT g.workspace_id,g.id FROM records g LEFT JOIN records m ON m.workspace_id=g.workspace_id AND m.kind='profile_human_refresh' AND m.id=g.id WHERE g.kind='game' AND (m.id IS NULL OR m.updated_at<now()-interval '24 hours') AND EXISTS (SELECT 1 FROM events e WHERE e.workspace_id=g.workspace_id AND e.game_id=g.id AND e.kind='human' AND e.received_at>coalesce(m.updated_at,'epoch'::timestamptz)) ORDER BY coalesce(m.updated_at,'epoch'::timestamptz),g.workspace_id,g.id LIMIT 5`);
    for (const game of games) if (await queueHumanProfileRefresh(game.workspace_id, game.id, process.env.APP_URL)) profileRecovered++;
  }
  await tickAutomation();
  const queued = await queueDailyResearch(),
    publishing = await duePublications();
  const [profile, content, ...research] = await Promise.all([
    drainProfile(),
    drainContentAutomation(),
    drainResearch(1),
    drainResearch(1),
    drainResearch(1),
  ]);
  return Response.json({
    queued,
    research,
    profile,
    profileRecovered,
    content,
    publishing,
    captureCleanup,
    remaining:
      "Additional games stay in the durable queue and are processed by the worker.",
  });
}
