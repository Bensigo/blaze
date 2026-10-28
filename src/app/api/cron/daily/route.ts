import { bearer } from "@/lib/security";
import { queueDailyResearch, drainResearch } from "@/lib/research-jobs";
import { duePublications } from "@/lib/publishing";
import { query } from "@/lib/db";
export const maxDuration = 60;
export async function GET(request: Request) {
  if (!bearer(request, "CRON_SECRET"))
    return new Response(null, { status: 401 });
  await query(`DELETE FROM rate_windows WHERE expires_at<now()`);
  await query(`DELETE FROM auth_sessions WHERE expires_at<now()`);
  const queued = await queueDailyResearch(),
    publishing = await duePublications();
  const research = await Promise.all([
    drainResearch(1),
    drainResearch(1),
    drainResearch(1),
  ]);
  return Response.json({
    queued,
    research,
    publishing,
    remaining:
      "Additional games stay in the durable queue and are processed by the worker.",
  });
}
