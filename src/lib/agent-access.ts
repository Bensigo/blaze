import { randomBytes } from "node:crypto";
import { z } from "zod";
import { get, list, put, query, remove, rateLimit } from "./db";
import { hash } from "./security";
import { HttpError } from "./http-error";
import type { Analytics } from "./types";

type AgentToken = { id: string; name: string; createdAt: string; expiresAt: string };
export async function issueAgentToken(workspace: string, name: string) {
  const cleanName = z.string().trim().min(1).max(80).parse(name);
  if ((await list<AgentToken>(workspace, "agent_token")).length >= 20) throw new HttpError(400, "Revoke an existing agent token first (limit 20).");
  const token = `blaze_ro_${randomBytes(32).toString("base64url")}`;
  const record: AgentToken = { id: hash(token), name: cleanName, createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 90 * 86400000).toISOString() };
  await put(workspace, "agent_token", record);
  return { ...record, token };
}
export const listAgentTokens = (workspace: string) => list<AgentToken>(workspace, "agent_token");
export async function revokeAgentToken(workspace: string, id: string) {
  if (!/^[a-f0-9]{64}$/.test(id)) throw new HttpError(400, "Invalid token id.");
  if (!await get<AgentToken>(workspace, "agent_token", id)) throw new HttpError(404, "Token not found.");
  await remove(workspace, "agent_token", id);
}
export async function requireAgentWorkspace(request: Request) {
  const match = /^Bearer (blaze_ro_[A-Za-z0-9_-]{43})$/.exec(request.headers.get("authorization") || "");
  if (!match) throw new HttpError(401, "A read-only Blaze agent token is required.");
  const tokenId = hash(match[1]);
  const rows = await query<{ workspace_id: string }>("SELECT workspace_id FROM records WHERE kind='agent_token' AND id=$1 AND (body->>'expiresAt')::timestamptz>now() LIMIT 2", [tokenId]);
  if (rows.length !== 1) throw new HttpError(401, "Agent token is invalid, expired or revoked.");
  if (!await rateLimit(`agent:${tokenId}`, 30)) throw new HttpError(429, "Too many report requests.");
  return rows[0].workspace_id;
}

/** Explicit allowlist: additions to dashboard analytics do not silently expand agent access. */
export function agentAnalytics(a: Analytics) {
  return { sessions: a.sessions, players: a.players, starts: a.starts, completions: a.completions, replays: a.replays, returns: a.returns, errorSessions: a.errorSessions, firstActions: a.firstActions, lastEventAt: a.lastEventAt, trend: a.trend?.map(({date, visits, starts, completions}) => ({date, visits, starts, completions})), funnel: a.funnel?.map(({name, count}) => ({name, count})), retention: a.retention?.map(({date, players, eligible, returned, rate}) => ({date, players, eligible, returned, rate})), countries: a.countries?.map(({name, count}) => ({name, count})), devices: a.devices?.map(({name, count}) => ({name, count})), coverage: a.coverage && Object.fromEntries(["countries", "devices"].filter(key => a.coverage?.[key]).map(key => [key, {shown:a.coverage![key].shown,total:a.coverage![key].total}])), activePlay: a.activePlay && (({totalSeconds, averageSeconds, medianSeconds, measuredSessions, eligibleSessions}) => ({totalSeconds, averageSeconds, medianSeconds, measuredSessions, eligibleSessions}))(a.activePlay), loadedSessions: a.loadedSessions, progressionSessions: a.progressionSessions,
    caveats: ["Pseudonymous browser identifiers are not verified people.", "Consent, blocked requests and missing instrumentation limit coverage.", "Retention includes mature cohorts only; comparisons are observational.", "Raw sessions, identifiers, campaign labels and private recordings are excluded from agent access."] };
}
