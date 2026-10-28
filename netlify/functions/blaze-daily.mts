import { dispatchDailyRequest } from '../../src/lib/daily-dispatch';
// Netlify evaluates this schedule in UTC; scheduled functions only run on published deploys.
export const config = { schedule: '0 6 * * *' };
export default async function () { await dispatchDailyRequest(); return new Response(null, { status: 204 }); }
