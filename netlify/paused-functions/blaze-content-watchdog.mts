import { dispatchContentWatchdog } from '../../src/lib/content-watchdog-dispatch';
// Deliberately outside netlify/functions: deploying the feature cannot register
// a recurring invocation. Move this file only after separate schedule approval.
export const config = { schedule: '* * * * *' };
export default async function () {
  await dispatchContentWatchdog();
  return new Response(null, { status: 204 });
}
