import { appOrigin } from "@/lib/app-origin";
import { googleAvailable, neonAuth } from "@/lib/neon-auth";

export async function GET(request: Request) {
  const origin = appOrigin(request);
  if (!origin || new URL(request.url).origin !== origin) return Response.json({ error: "Sign-in is not configured." }, { status: 503, headers: { "Cache-Control": "no-store" } });
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
    if (target.protocol !== "https:" || target.hostname !== "accounts.google.com") return unavailable();
    const setCookies = result.headers.getSetCookie();
    if (!setCookies.some((cookie) => /^__Secure-neon-auth\.session_chall(?:enge|ange)=/.test(cookie))) return unavailable();
    const headers = new Headers({ Location: target.toString(), "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" });
    for (const cookie of setCookies) headers.append("Set-Cookie", cookie);
    return new Response(null, { status: 303, headers });
  } catch { return unavailable(); }
}
