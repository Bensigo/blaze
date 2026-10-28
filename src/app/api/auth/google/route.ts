import { Google, generateState, generateCodeVerifier } from "arctic";
import { cookies } from "next/headers";
export async function GET(request: Request) {
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET)
    return Response.json(
      {
        error:
          "Google sign-in needs the owner’s Google OAuth application. Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in the deployment settings. See Setup → Google sign-in.",
      },
      { status: 503 },
    );
  const base = process.env.APP_URL || new URL(request.url).origin;
  const client = new Google(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    `${base}/api/auth/callback/google`,
  );
  const state = generateState(),
    verifier = generateCodeVerifier();
  const jar = await cookies();
  const options = {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: 600,
  };
  jar.set("oauth_state", state, options);
  jar.set("oauth_verifier", verifier, options);
  return Response.redirect(
    client.createAuthorizationURL(state, verifier, [
      "openid",
      "email",
      "profile",
    ]),
  );
}
