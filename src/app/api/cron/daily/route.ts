import { bearer } from '@/lib/security';
import { runMaintenance } from '@/lib/maintenance';
export const maxDuration = 60;
export async function GET(request: Request) {
  if (!bearer(request, 'CRON_SECRET')) return new Response(null, { status: 401 });
  await runMaintenance();
  return Response.json({ ok: true });
}
