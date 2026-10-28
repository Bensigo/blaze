import { appOrigin, canonicalRequestUrl } from "@/lib/app-origin";
import { googleAvailable, neonAuth, neonAuthConfig } from "@/lib/neon-auth";

export async function GET(request: Request) {
  const origin = appOrigin(request);
  if (!origin || !canonicalRequestUrl(request)) {
    console.error("Google sign-in canonical URL unavailable", { requestOrigin: new URL(request.url).origin, configuredOrigin: origin, host: request.headers.get("host") });
    return Response.json({ error: "Sign-in is not configured." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
  const unavailable = () => new Response(null, { status: 303, headers: { Location: `${origin}/app?auth=setup`, "Cache-Control": "private, no-store" } });
  const auth = neonAuth();
  if (!googleAvailable() || !auth) return unavailable();
  try {
    // Use Neon's Next.js proxy, which transfers the OAuth challenge to a secure
    // browser cookie and lets Neon manage the provider state and exchange.
    const proxyRequest = new Request(`${origin}/api/auth/sign-in/social`, {
      method: "POST", headers: { Origin: origin, "Content-Type": "application/json", Cookie: request.headers.get("cookie") || "" },
      body: JSON.stringify({ provider: "google", callbackURL: `${origin}/api/auth/callback/google`, errorCallbackURL: `${origin}/app?auth=failed` }),
    });
    const result = await auth.handler().POST(proxyRequest, { params: Promise.resolve({ path: ["sign-in", "social"] }) });
    if (!result.ok) return unavailable();
    const body = await result.json();
    const target = new URL(body?.url);
    const config = neonAuthConfig();
    if (!config || target.protocol !== "https:" || target.username || target.password || target.href.includes("#")) return unavailable();
    const base = new URL(config.baseUrl);
    const token = target.searchParams.get("token");
    const neonInit = target.origin === base.origin &&
      target.pathname === `${base.pathname.replace(/\/$/, "")}/sign-in/social/init` &&
      target.search.length <= 8192 && /^\?token=[^&]+$/.test(target.search) &&
      target.searchParams.getAll("token").length === 1 && !!token?.trim() &&
      token.length <= 4096 && !/[\x00-\x1f\x7f]/.test(token);
    const directGoogle = target.origin === "https://accounts.google.com";
    if (!neonInit && !directGoogle) return unavailable();
    const setCookies = result.headers.getSetCookie();
    if (!setCookies.some((cookie) => /^__Secure-neon-auth\.session_chall(?:enge|ange)=/.test(cookie))) return unavailable();
    const headers = new Headers({ Location: target.toString(), "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" });
    for (const cookie of setCookies) headers.append("Set-Cookie", cookie);
    return new Response(null, { status: 303, headers });
  } catch { return unavailable(); }
}
