import { apiError, requireIdentity } from '@/lib/auth';
import { maintenanceStatus } from '@/lib/maintenance';
export async function GET() {
  try {
    await requireIdentity();
    return Response.json(await maintenanceStatus(), { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) { return apiError(error); }
}
