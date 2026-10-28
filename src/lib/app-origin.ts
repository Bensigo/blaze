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
