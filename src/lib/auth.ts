import { cookies } from "next/headers";
import { randomBytes } from "node:crypto";
import { query, id } from "./db";
import { hash } from "./security";
import { clearNeonCookies, googleAvailable, neonAuth } from "./neon-auth";
export interface Identity {
  id: string;
  email: string;
  name: string;
  workspace_id: string;
}
const localSessionsAllowed = () => (process.env.NODE_ENV === "development" || process.env.NODE_ENV === "test") && !process.env.VERCEL;
export async function identity(): Promise<Identity | null> {
  const client = googleAvailable() ? neonAuth() : null;
  if (client) {
    try {
      // Do not trust a client-supplied profile or cached session for authorization.
      const { data, error } = await client.getSession({ query: { disableCookieCache: "true" } });
      const user = data?.user;
      if (!error && user && typeof user.id === "string" && user.id.length > 0 && user.id.length <= 200 &&
          typeof user.email === "string" && user.email.length > 0 && user.email.length <= 320 && user.emailVerified === true) {
        // Namespace provider identities; email and editable metadata never select a workspace.
        const userId = `neon:${user.id}`;
        const name = (typeof user.name === "string" ? user.name.trim() : "").slice(0, 120) || user.email.slice(0, 120);
        const existing = (await query<Identity>(`SELECT id,email,name,workspace_id FROM users WHERE id=$1`, [userId]))[0];
        if (existing && existing.email === user.email && existing.name === name) return existing;
        return (await query<Identity>(`INSERT INTO users(id,email,name,workspace_id) VALUES($1,$2,$3,$4) ON CONFLICT(id) DO UPDATE SET email=excluded.email,name=excluded.name RETURNING id,email,name,workspace_id`, [userId, user.email, name, id("ws")]))[0] || null;
      }
    } catch { /* An unavailable auth service cannot authenticate a request. */ }
  }
  if (!localSessionsAllowed()) return null;
  const token = (await cookies()).get("studio_session")?.value;
  if (!token) return null;
  return (await query<Identity>(
    `SELECT u.* FROM auth_sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now()`,
    [hash(token)],
  ))[0] || null;
}
export async function requireIdentity() {
  const user = await identity();
  if (!user) throw new HttpError(401, "Sign in to use your workspace.");
  return user;
}
export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export async function createSession(input: { id: string; email: string; name: string; }) {
  if (!localSessionsAllowed()) throw new Error("Local sessions are disabled.");
  const user = (await query<Identity>(
    `INSERT INTO users(id,email,name,workspace_id) VALUES($1,$2,$3,$4) ON CONFLICT(id) DO UPDATE SET email=excluded.email,name=excluded.name RETURNING *`,
    [input.id, input.email, input.name, id("ws")],
  ))[0];
  const token = randomBytes(32).toString("base64url");
  await query("INSERT INTO auth_sessions(token_hash,user_id,expires_at) VALUES($1,$2,$3)",
    [hash(token), user.id, new Date(Date.now() + 7 * 86400000).toISOString()]);
  (await cookies()).set("studio_session", token, { httpOnly: true, secure: false, sameSite: "lax", path: "/", maxAge: 7 * 86400 });
  return user;
}
export async function logout() {
  const client = neonAuth();
  const jar = await cookies();
  let revoked = !jar.get("__Secure-neon-auth.session_token");
  try { if (client) { const result = await client.signOut(); revoked = !result.error; } } catch { revoked = false; }
  await clearNeonCookies();
  const token = jar.get("studio_session")?.value;
  if (token && localSessionsAllowed()) await query("DELETE FROM auth_sessions WHERE token_hash=$1", [hash(token)]);
  jar.delete("studio_session");
  return { revoked };
}
export function apiError(error: unknown) {
  if (error instanceof HttpError) return Response.json({ error: error.message }, { status: error.status });
  console.error("Request failed", error instanceof Error ? error.name : "UnknownError");
  return Response.json({ error: "The request could not be completed. Check connection setup or try again." }, { status: 500 });
}
