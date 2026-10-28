import { cookies } from "next/headers";
import { randomBytes } from "node:crypto";
import { query, id } from "./db";
import { hash } from "./security";
export interface Identity {
  id: string;
  email: string;
  name: string;
  workspace_id: string;
}
export async function identity(): Promise<Identity | null> {
  const token = (await cookies()).get("studio_session")?.value;
  if (!token) return null;
  const row = (
    await query<Identity>(
      `SELECT u.* FROM auth_sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now()`,
      [hash(token)],
    )
  )[0];
  return row || null;
}
export async function requireIdentity() {
  const user = await identity();
  if (!user) throw new HttpError(401, "Sign in to use your workspace.");
  return user;
}
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export async function createSession(input: {
  id: string;
  email: string;
  name: string;
}) {
  const user = (
    await query<Identity>(
      `INSERT INTO users(id,email,name,workspace_id) VALUES($1,$2,$3,$4) ON CONFLICT(id) DO UPDATE SET email=excluded.email,name=excluded.name RETURNING *`,
      [input.id, input.email, input.name, id("ws")],
    )
  )[0];
  const token = randomBytes(32).toString("base64url");
  await query(
    "INSERT INTO auth_sessions(token_hash,user_id,expires_at) VALUES($1,$2,$3)",
    [hash(token), user.id, new Date(Date.now() + 7 * 86400000).toISOString()],
  );
  (await cookies()).set("studio_session", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 7 * 86400,
  });
  return user;
}
export async function logout() {
  const jar = await cookies();
  const token = jar.get("studio_session")?.value;
  if (token)
    await query("DELETE FROM auth_sessions WHERE token_hash=$1", [hash(token)]);
  jar.delete("studio_session");
}
export function apiError(error: unknown) {
  if (error instanceof HttpError)
    return Response.json({ error: error.message }, { status: error.status });
  console.error(
    "Request failed",
    error instanceof Error ? error.name : "UnknownError",
  );
  return Response.json(
    {
      error:
        "The request could not be completed. Check connection setup or try again.",
    },
    { status: 500 },
  );
}
