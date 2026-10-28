import { Google } from "arctic";
import { cookies } from "next/headers";
import { createSession } from "@/lib/auth";
import { constantEqual } from "@/lib/security";
export async function GET(request: Request) {
  const url = new URL(request.url),
    jar = await cookies();
  const state = jar.get("oauth_state")?.value,
    verifier = jar.get("oauth_verifier")?.value;
  jar.delete("oauth_state");
  jar.delete("oauth_verifier");
  if (
    !state ||
    !verifier ||
    !constantEqual(url.searchParams.get("state") || "", state) ||
    !url.searchParams.get("code")
  )
    return Response.json(
      { error: "Sign-in expired. Start Google sign-in again." },
      { status: 400 },
    );
  try {
    const base = process.env.APP_URL || url.origin;
    const client = new Google(
      process.env.GOOGLE_CLIENT_ID!,
      process.env.GOOGLE_CLIENT_SECRET!,
      `${base}/api/auth/callback/google`,
    );
    const token = await client.validateAuthorizationCode(
      url.searchParams.get("code")!,
      verifier,
    );
    const result = await fetch(
      "https://openidconnect.googleapis.com/v1/userinfo",
      {
        headers: { Authorization: `Bearer ${token.accessToken()}` },
        signal: AbortSignal.timeout(10000),
      },
    );
    if (!result.ok) throw new Error("Profile unavailable");
    const user = await result.json();
    if (!user.sub || !user.email_verified)
      throw new Error("Verified Google email required");
    await createSession({
      id: `google:${user.sub}`,
      email: user.email,
      name: user.name || user.email,
    });
    return Response.redirect(`${base}/`);
  } catch {
    return Response.json(
      {
        error:
          "Google sign-in failed. Check the OAuth application and callback URL.",
      },
      { status: 400 },
    );
  }
}
