/** Classify only the exact controlled lab hosted by the configured application. */
export function isControlledLabTarget(target: string, appUrl: string | undefined): boolean {
  try {
    if (!appUrl) return false;
    const app = new URL(appUrl);
    const url = new URL(target);
    if (!['http:', 'https:'].includes(app.protocol) || app.username || app.password || app.pathname !== '/' || app.search || app.hash) return false;
    return !url.username && !url.password && !url.search && !url.hash && url.origin === app.origin && url.pathname === '/fixture/decision-validation.html';
  } catch { return false; }
}
