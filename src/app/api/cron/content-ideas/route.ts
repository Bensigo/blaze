import { bearer } from "@/lib/security";
import { query } from "@/lib/db";
import { runDailyIdeas } from "@/lib/daily-content-ideas";
export const maxDuration = 60;
export async function POST(request: Request) {
  if (!bearer(request, "CRON_SECRET")) return new Response(null, { status: 401 });
  if (process.env.BLAZE_DAILY_IDEAS_ENABLED !== "true") return Response.json({ paused: true });
  // No schedule is registered by this route. An operator must approve and provision its trigger separately.
  const workspaces = await query<{ workspace_id: string }>(`SELECT workspace_id FROM records WHERE kind='idea_schedule' AND id='default' AND body->>'enabled'='true' ORDER BY workspace_id LIMIT 10`);
  const results = [];
  for (const row of workspaces) results.push({ workspace: row.workspace_id, result: await runDailyIdeas(row.workspace_id) });
  return Response.json({ results });
}
