import { consumeDailyDispatch, dailyAuthorized } from '../../src/lib/daily-dispatch';
export const config = { background: true };
export default async function (request: Request) {
  if (request.method !== 'POST' || !dailyAuthorized(request)) throw new Error('Daily consumer authorization failed');
  if (process.env.BLAZE_LEGACY_DAILY_ENABLED !== "true") return;
  await consumeDailyDispatch();
}
