import { bearer } from "@/lib/security";
import { query } from "@/lib/db";
import { cleanupCaptures } from "@/lib/session-capture";

export const maxDuration = 60;
export async function GET(request: Request) {
  if (!bearer(request, "CRON_SECRET")) return new Response(null, { status: 401 });
  await query(`DELETE FROM rate_windows WHERE expires_at<now()`);
  await query(`DELETE FROM auth_sessions WHERE expires_at<now()`);
  return Response.json({ captureCleanup: await cleanupCaptures() });
}
