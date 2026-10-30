import { dispatchDailyRequest } from '../../src/lib/daily-dispatch';
// Netlify evaluates this schedule in UTC; scheduled functions only run on published deploys.
export const config = { schedule: '0 6 * * *' };
export default async function () { if (process.env.BLAZE_LEGACY_DAILY_ENABLED !== "true") return Response.json({ paused: true }); await dispatchDailyRequest(); return new Response(null, { status: 204 }); }
