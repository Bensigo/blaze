import { runMaintenance } from '../../src/lib/maintenance';
export const config = { schedule: '0 6 * * *' };
export default async function () {
  await runMaintenance();
  return new Response(null, { status: 204 });
}
