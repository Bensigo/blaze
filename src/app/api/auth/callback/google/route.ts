import { NextRequest } from "next/server";
import { appOrigin } from "@/lib/app-origin";
import { googleAvailable, neonAuth } from "@/lib/neon-auth";

export async function GET(request: Request) {
  const origin = appOrigin(request);
  if (!origin) return Response.json({ error: "Sign-in is not configured." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  const failed = () => new Response(null, { status: 303, headers: { Location: `${origin}/app?auth=failed`, "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" } });
  const url = new URL(request.url), verifier = url.searchParams.get("neon_auth_session_verifier"), auth = neonAuth();
  if (url.origin !== origin || !googleAvailable() || !auth || !verifier || verifier.length > 4096 || url.searchParams.has("error")) return failed();
  try {
    // The official middleware checks the browser challenge cookie and exchanges
    // Neon's one-time session verifier; do not reflect the verifier in redirects.
    const result = await auth.middleware({ loginUrl: "/app" })(new NextRequest(request));
    const location = result.headers.get("location"), cookies = result.headers.getSetCookie();
    if (!location || new URL(location).origin !== origin || new URL(location).pathname !== url.pathname ||
        new URL(location).searchParams.has("neon_auth_session_verifier") ||
        !cookies.some((cookie) => /^__Secure-neon-auth\.session_token=/.test(cookie))) return failed();
    const headers = new Headers({ Location: `${origin}/app`, "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" });
    for (const cookie of cookies) headers.append("Set-Cookie", cookie);
    return new Response(null, { status: 303, headers });
  } catch { return failed(); }
}
