const localHostnames = ["localhost", "127.0.0.1", "[::1]"];
export function appOrigin(request: Request): string | null {
  const configured = process.env.APP_URL;
  if (configured) {
    try {
      const url = new URL(configured);
      if (url.username || url.password || url.search || url.hash || url.pathname !== "/") return null;
      return url.protocol === "https:" || (url.protocol === "http:" && localHostnames.includes(url.hostname) && !process.env.VERCEL && process.env.NODE_ENV !== "production") ? url.origin : null;
    } catch { return null; }
  }
  if (process.env.NODE_ENV === "production" || process.env.VERCEL) return null;
  const url = new URL(request.url);
  return url.protocol === "http:" && localHostnames.includes(url.hostname) ? url.origin : null;
}
import { getContext } from "@netlify/functions";


// Next's server adapter can retain the hostname/protocol of a warm-up request.
// Recover the browser URL only for the configured Netlify site and exact Host.
// Forwarded headers never select a callback destination.
export function canonicalRequestUrl(request: Request): URL | null {
  const origin = appOrigin(request);
  if (!origin) return null;
  const url = new URL(request.url);
  if (url.origin === origin) return url;
  if (process.env.NODE_ENV !== "production" || !process.env.SITE_ID) return null;
  try {
    const context = getContext(), expected = new URL(origin);
    if (typeof context.site.url !== "string") return null;
    const site = new URL(context.site.url);
    if (context.site.id !== process.env.SITE_ID || site.host !== expected.host ||
        !["http:", "https:"].includes(site.protocol) || site.username || site.password ||
        request.headers.get("host") !== expected.host) return null;
    url.protocol = expected.protocol;
    url.host = expected.host;
    return url;
  } catch { return null; }
}
