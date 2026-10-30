import { tickContentService } from '../../src/lib/content-service';
// Persistent minute service explicitly approved on 2026-10-30.
// Runtime gates and owner-scoped grants still guard every metered stage.
export const config = { schedule: '* * * * *' };
export default async function () {
  if (process.env.BLAZE_CLOUD_WATCHDOG_SCHEDULE_ENABLED !== 'true') return new Response(null, { status: 204 });
  if (process.env.CONTEXT !== 'production' || process.env.BLAZE_CLOUD_WATCHDOG_ENABLED !== 'true') throw new Error('Production monitoring is not commissioned.');
  const workspace = process.env.BLAZE_CLOUD_WATCHDOG_WORKSPACE_ID?.trim();
  if (!workspace || workspace.length > 100 || /[\u0000-\u001f\u007f]/.test(workspace)) throw new Error('Monitoring workspace is missing.');
  // Native schedule invokes shared code directly: no public bearer endpoint,
  // internal HTTP hop, provider POST retry, or browser lifetime dependency.
  await tickContentService(workspace);
  return new Response(null, { status: 204 });
}
