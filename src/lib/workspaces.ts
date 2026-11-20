import { cookies } from "next/headers";
import { get, id, query, transaction } from "./db";
import { HttpError } from "./http-error";
import type { Identity } from "./auth";

/**
 * Several workspaces per account. Every account keeps its first workspace (users.workspace_id, its "home").
 * Further workspaces live in the records table, scoped to themselves:
 *   (workspace, 'workspace', 'meta')   its name, who made it and when
 *   (workspace, 'member', <user id>)   one row per member
 * The active workspace is named by a cookie that is checked against membership on every request, so a forged or
 * stale cookie only ever falls back to the home workspace. Every existing query keeps using identity.workspace_id.
 */
export const ACTIVE_WORKSPACE_COOKIE = "blaze_workspace";
export const MAX_WORKSPACES = 10;
export const HOME_WORKSPACE_NAME = "Your workspace";
const WORKSPACE_ID = /^ws_[a-f0-9]{32}$/;

export interface WorkspaceMeta {
  id: "meta";
  name: string;
  createdBy: string;
  createdAt: string;
}
export interface WorkspaceMember {
  id: string;
  role: "owner";
  joinedAt: string;
}
export interface WorkspaceSummary {
  id: string;
  name: string;
  home: boolean;
  active: boolean;
}

/** 1–60 printable characters, trimmed; anything else is refused. */
export function workspaceName(raw: unknown): string {
  const name = typeof raw === "string" ? raw.replace(/\s+/g, " ").trim() : "";
  if (!name || name.length > 60 || /[\u0000-\u001f\u007f]/.test(name)) throw new HttpError(400, "Name the workspace in 1 to 60 characters.");
  return name;
}

export const homeOf = (user: Identity) => user.home_workspace_id ?? user.workspace_id;

async function memberOf(workspace: string, userId: string) {
  return !!(await get<WorkspaceMember>(workspace, "member", userId));
}

/** The signed-in account, working in the workspace its cookie names when it is a member there; else its home. */
export async function withActiveWorkspace(user: Identity): Promise<Identity> {
  const home = user.workspace_id;
  const base = { ...user, home_workspace_id: home };
  let chosen: string | undefined;
  try {
    chosen = (await cookies()).get(ACTIVE_WORKSPACE_COOKIE)?.value;
  } catch {
    return base;
  }
  if (!chosen || chosen === home || !WORKSPACE_ID.test(chosen)) return base;
  return (await memberOf(chosen, user.id)) ? { ...base, workspace_id: chosen } : base;
}

/** The workspaces this account can open: its home first, then the rest in the order they were made. */
export async function listWorkspaces(user: Identity): Promise<WorkspaceSummary[]> {
  const home = homeOf(user);
  const joined = await query<{ workspace_id: string }>(`SELECT workspace_id FROM records WHERE kind='member' AND id=$1 ORDER BY updated_at`, [user.id]);
  const ids = [home, ...joined.map((row) => row.workspace_id).filter((ws) => ws !== home)];
  const metas = await query<{ workspace_id: string; body: WorkspaceMeta }>(
    `SELECT workspace_id,body FROM records WHERE kind='workspace' AND id='meta' AND workspace_id = ANY($1::text[])`,
    [ids],
  );
  return ids.map((ws) => ({
    id: ws,
    name: metas.find((row) => row.workspace_id === ws)?.body.name || (ws === home ? HOME_WORKSPACE_NAME : "Workspace"),
    home: ws === home,
    active: ws === user.workspace_id,
  }));
}

/** The active workspace's name, for the dashboard. */
export async function activeWorkspaceName(user: Identity): Promise<string> {
  const meta = await get<WorkspaceMeta>(user.workspace_id, "workspace", "meta");
  return meta?.name || (user.workspace_id === homeOf(user) ? HOME_WORKSPACE_NAME : "Workspace");
}

export async function createWorkspace(user: Identity, rawName: unknown): Promise<string> {
  const name = workspaceName(rawName);
  if ((await listWorkspaces(user)).length >= MAX_WORKSPACES) throw new HttpError(409, `An account can have up to ${MAX_WORKSPACES} workspaces.`);
  const workspace = id("ws");
  const now = new Date().toISOString();
  const meta: WorkspaceMeta = { id: "meta", name, createdBy: user.id, createdAt: now };
  const member: WorkspaceMember = { id: user.id, role: "owner", joinedAt: now };
  await transaction(async (q) => {
    await q(`INSERT INTO records(workspace_id,kind,id,body) VALUES($1,'workspace','meta',$2::jsonb)`, [workspace, JSON.stringify(meta)]);
    await q(`INSERT INTO records(workspace_id,kind,id,body) VALUES($1,'member',$2,$3::jsonb)`, [workspace, user.id, JSON.stringify(member)]);
  });
  return workspace;
}

/** Only a workspace this account can open: its home, or one it is a member of. */
export async function requireOwnWorkspace(user: Identity, workspace: unknown): Promise<string> {
  if (typeof workspace !== "string" || !WORKSPACE_ID.test(workspace)) throw new HttpError(404, "Workspace not found.");
  if (workspace === homeOf(user) || (await memberOf(workspace, user.id))) return workspace;
  throw new HttpError(404, "Workspace not found.");
}

export async function renameWorkspace(user: Identity, workspace: unknown, rawName: unknown) {
  const ws = await requireOwnWorkspace(user, workspace);
  const name = workspaceName(rawName);
  const meta = await get<WorkspaceMeta>(ws, "workspace", "meta");
  const next: WorkspaceMeta = meta ? { ...meta, name } : { id: "meta", name, createdBy: user.id, createdAt: new Date().toISOString() };
  await query(
    `INSERT INTO records(workspace_id,kind,id,body) VALUES($1,'workspace','meta',$2::jsonb) ON CONFLICT(workspace_id,kind,id) DO UPDATE SET body=excluded.body,updated_at=now()`,
    [ws, JSON.stringify(next)],
  );
}

/** Points this browser at a workspace (the home workspace clears the cookie). Membership is checked on every request. */
export async function setActiveWorkspace(user: Identity, workspace: string) {
  const jar = await cookies();
  if (workspace === homeOf(user)) return void jar.delete(ACTIVE_WORKSPACE_COOKIE);
  jar.set(ACTIVE_WORKSPACE_COOKIE, workspace, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 365 * 86400,
  });
}
