import { cleanupCaptures } from '../../src/lib/session-capture';
import { query } from '../../src/lib/db';
export const config = { schedule: '0 6 * * *' };
export default async function () {
  await query(`DELETE FROM rate_windows WHERE expires_at<now()`);
  await query(`DELETE FROM auth_sessions WHERE expires_at<now()`);
  await cleanupCaptures();
  return new Response(null, { status: 204 });
}
