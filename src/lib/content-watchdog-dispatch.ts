// An independent Netlify scheduled function dispatches to the existing authenticated
// route. No browser/client lifetime, inference, session creation or retries here.
export async function dispatchContentWatchdog() {
  if (process.env.BLAZE_CLOUD_WATCHDOG_SCHEDULE_ENABLED !== "true") return { paused: true };
  if (process.env.CONTEXT !== "production") throw new Error("Watchdog schedule requires a production deployment.");
  if (process.env.BLAZE_CLOUD_WATCHDOG_ENABLED !== "true") throw new Error("Watchdog route is paused.");
  const workspaceId = process.env.BLAZE_CLOUD_WATCHDOG_WORKSPACE_ID?.trim();
  const token = process.env.CRON_SECRET?.trim();
  if (!workspaceId || workspaceId.length > 100 || /[\u0000-\u001f\u007f]/.test(workspaceId) || !token) throw new Error("Watchdog schedule is not configured.");
  // URL is Netlify's production site URL. DEPLOY_PRIME_URL can be a preview and
  // must never select the recipient of this server-side bearer.
  const raw = process.env.URL;
  if (!raw) throw new Error("Production site URL is unavailable.");
  const origin = new URL(raw);
  if (origin.origin !== "https://blaze-bensigo.netlify.app" || origin.username || origin.password || origin.search || origin.hash || origin.pathname !== "/") throw new Error("Unexpected watchdog destination.");
  const response = await fetch(new URL("/api/cron/content-production-watchdog", origin), {
    method: "POST", redirect: "error", signal: AbortSignal.timeout(25000),
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ workspaceId }),
  });
  if (!response.ok) throw new Error("Watchdog dispatch failed; new production requires a fresh healthy heartbeat.");
  return { paused: false };
}
