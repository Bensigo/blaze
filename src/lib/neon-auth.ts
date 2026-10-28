import { createNeonAuth } from "@neondatabase/auth/next/server";
import { cookies } from "next/headers";

// OAuth is enabled only after the owner installs their own Google client in Neon.
// The presence of a Neon URL alone would otherwise enable its shared test client.
export function neonAuthConfig() {
  const baseUrl = process.env.NEON_AUTH_BASE_URL;
  const secret = process.env.NEON_AUTH_COOKIE_SECRET;
  if (!baseUrl || !secret || secret.length < 32) return null;
  try {
    const url = new URL(baseUrl);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) return null;
    return { baseUrl: url.toString().replace(/\/$/, ""), secret };
  } catch { return null; }
}
export function googleAvailable() {
  return Boolean(neonAuthConfig() && process.env.NEON_AUTH_GOOGLE_CONFIGURED === "true");
}
export function neonAuth() {
  const config = neonAuthConfig();
  if (!config) return null;
  return createNeonAuth({ baseUrl: config.baseUrl, cookies: { secret: config.secret, sameSite: "lax" }, logLevel: "silent" });
}
export async function clearNeonCookies() {
  const jar = await cookies();
  for (const { name } of jar.getAll()) {
    if (name === "__Secure-neon-auth.session_token" || name === "__Secure-neon-auth.local.session_data" ||
        name === "__Secure-neon-auth.session_challenge" || name === "__Secure-neon-auth.session_challange" ||
        name.startsWith("__Secure-neon-auth.session_token.") || name.startsWith("__Secure-neon-auth.local.session_data.")) {
      jar.set(name, "", { path: "/", maxAge: 0, httpOnly: true, secure: true, sameSite: "lax" });
    }
  }
}
