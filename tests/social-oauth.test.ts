import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import type { Identity } from "../src/lib/auth";
import type { SocialGrant } from "../src/lib/social-provider";

const browser = vi.hoisted(() => ({ cookies: new Map<string, string>() }));
vi.mock("next/headers", () => ({ cookies: async () => ({
  get: (name: string) => browser.cookies.has(name) ? { name, value: browser.cookies.get(name) } : undefined,
  set: (name: string, value: string, options?: { maxAge?: number }) => { if (options?.maxAge === 0) browser.cookies.delete(name); else browser.cookies.set(name, value); },
  delete: (name: string) => browser.cookies.delete(name),
}) }));

import { query, list, closeDatabase } from "../src/lib/db";
import { decrypt, hash } from "../src/lib/security";
import { xAdapter, youtubeAdapter } from "../src/lib/social-x-youtube";
import { beginSocialAuthorization, finishSocialAuthorization, refreshSocialConnection, disconnectSocialConnection } from "../src/lib/social-oauth";
import type { Connection } from "../src/lib/types";
import * as auth from "../src/lib/auth";
import { POST as refreshRoute } from "../src/app/api/social/[provider]/refresh/route";
import { GET as callbackRoute } from "../src/app/api/social/[provider]/callback/route";

const user: Identity = { id: "user1", email: "one@example.test", name: "One", workspace_id: "workspace1" };
const other: Identity = { ...user, id: "user2", workspace_id: "workspace2" };
const origin = "http://localhost:3000";
const connect = new Request(`${origin}/api/social/x/connect`, { method: "POST" });
const cb = (state: string, extra = "code=auth-code", provider = "x") => new Request(`${origin}/api/social/${provider}/callback?state=${state}&${extra}`);
const grant = (overrides: Partial<SocialGrant> = {}): SocialGrant => ({ accountId: "account1", accountName: "Account One", scopes: [...xAdapter.requiredScopes], expiresAt: Date.now() + 3600_000, secret: { token: "access-secret", refreshToken: "refresh-secret" }, ...overrides });

async function begin(identity = user, connectionId?: string) {
  const url = new URL(await beginSocialAuthorization(identity, "x", connect, connectionId));
  return { state: url.searchParams.get("state")!, challenge: url.searchParams.get("challenge")! };
}
async function connected() {
  const flow = await begin();
  await finishSocialAuthorization(user, "x", cb(flow.state));
  return (await list<Connection>(user.workspace_id, "connection"))[0];
}

beforeAll(() => {
  vi.stubEnv("LOCAL_DATABASE_PATH", "memory://"); vi.stubEnv("DATABASE_URL", ""); vi.stubEnv("VERCEL", "");
  vi.stubEnv("APP_URL", origin); vi.stubEnv("CREDENTIAL_KEY", Buffer.alloc(32, 7).toString("base64"));
});
beforeEach(async () => {
  browser.cookies.clear(); vi.restoreAllMocks();
  await query("DELETE FROM credentials"); await query("DELETE FROM records");
  vi.spyOn(xAdapter, "configured").mockReturnValue(true);
  vi.spyOn(xAdapter, "authorizationUrl").mockImplementation(({ state, challenge }) => `${origin}/mock?state=${state}&challenge=${challenge}`);
  vi.spyOn(xAdapter, "exchange").mockResolvedValue(grant());
  vi.spyOn(xAdapter, "refresh").mockResolvedValue(grant({ secret: { token: "rotated-access", refreshToken: "rotated-refresh" } }));
  vi.spyOn(xAdapter, "revoke").mockResolvedValue();
});
afterAll(async () => { await closeDatabase(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

it("stores hashed one-use state and encrypted PKCE, verifies the challenge, and encrypts credentials", async () => {
  const { state, challenge } = await begin();
  const pending = (await query<{ id: string; body: { verifier: string } }>("SELECT id,body FROM records WHERE workspace_id=$1 AND kind='social_oauth_state'", [user.workspace_id]))[0];
  expect(pending.id).toBe(hash(state)); expect(JSON.stringify(pending)).not.toContain(state);
  const verifier = (await decrypt(pending.body.verifier)).token;
  expect(pending.body.verifier).not.toContain(verifier);
  expect(createHash("sha256").update(verifier).digest("base64url")).toBe(challenge);
  const cookie = [...browser.cookies.entries()][0];
  expect(await finishSocialAuthorization(user, "x", cb(state))).toBe("connected");
  expect(xAdapter.exchange).toHaveBeenCalledWith({ code: "auth-code", verifier, redirectUri: `${origin}/api/social/x/callback` });
  browser.cookies.set(...cookie);
  await expect(finishSocialAuthorization(user, "x", cb(state))).rejects.toThrow(/already used/);
  const records = await list<Connection>(user.workspace_id, "connection");
  expect(records).toHaveLength(1); expect(JSON.stringify(records)).not.toContain("access-secret");
  const credential = (await query<{ encrypted: string }>("SELECT encrypted FROM credentials WHERE workspace_id=$1 AND provider=$2", [user.workspace_id, records[0].id]))[0];
  expect(credential.encrypted).not.toContain("access-secret"); expect(credential.encrypted).not.toContain("refresh-secret");
  expect(await decrypt(credential.encrypted)).toMatchObject({ token: "access-secret", refreshToken: "refresh-secret", accountId: "account1" });
  expect(await list(other.workspace_id, "connection")).toEqual([]);
});

it.each([
  ["workspace", other, "x"],
  ["user", { ...user, id: "user2" }, "x"],
  ["provider", user, "youtube"],
] as const)("rejects state for wrong %s", async (_, caller, provider) => {
  const { state } = await begin();
  await expect(finishSocialAuthorization(caller, provider, cb(state, "code=auth-code", provider))).rejects.toThrow(/Invalid, expired or already used/);
  expect(xAdapter.exchange).not.toHaveBeenCalled();
  expect(await list(user.workspace_id, "connection")).toEqual([]);
});

it("rejects a different browser without consuming database state", async () => {
  const { state } = await begin(); const cookie = [...browser.cookies.entries()][0]; browser.cookies.clear();
  await expect(finishSocialAuthorization(user, "x", cb(state))).rejects.toThrow(/another browser/);
  browser.cookies.set(...cookie);
  expect(await finishSocialAuthorization(user, "x", cb(state))).toBe("connected");
});

it("consumes denial once without exchanging and rejects expiry", async () => {
  const denied = await begin(); const cookie = [...browser.cookies.entries()][0];
  expect(await finishSocialAuthorization(user, "x", cb(denied.state, "error=access_denied"))).toBe("denied");
  browser.cookies.set(...cookie);
  await expect(finishSocialAuthorization(user, "x", cb(denied.state))).rejects.toThrow(/already used/);
  const expired = await begin();
  await query("UPDATE records SET body=jsonb_set(body,'{expiresAt}',to_jsonb($3::text)) WHERE workspace_id=$1 AND kind='social_oauth_state' AND id=$2", [user.workspace_id, hash(expired.state), "2000-01-01T00:00:00.000Z"]);
  await expect(finishSocialAuthorization(user, "x", cb(expired.state))).rejects.toThrow(/expired/);
  expect(xAdapter.exchange).not.toHaveBeenCalled();
});

it("rejects reconnect of a different account without replacing the original", async () => {
  const current = await connected(); const { state } = await begin(user, current.id);
  vi.mocked(xAdapter.exchange).mockResolvedValueOnce(grant({ accountId: "different", accountName: "Different" }));
  expect(await finishSocialAuthorization(user, "x", cb(state))).toBe("account_mismatch");
  expect(xAdapter.revoke).not.toHaveBeenCalled();
  expect((await list<Connection>(user.workspace_id, "connection"))[0].accountId).toBe("account1");
  const stored = (await query<{ encrypted: string }>("SELECT encrypted FROM credentials WHERE workspace_id=$1 AND provider=$2", [user.workspace_id, current.id]))[0];
  expect((await decrypt(stored.encrypted)).token).toBe("access-secret");
});

it("serializes separate callbacks for the same verified account", async () => {
  const first = await begin(), second = await begin();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  vi.mocked(xAdapter.exchange).mockImplementation(async () => { await gate; return grant(); });
  const pending = [finishSocialAuthorization(user, "x", cb(first.state)), finishSocialAuthorization(user, "x", cb(second.state))];
  await vi.waitFor(() => expect(xAdapter.exchange).toHaveBeenCalledTimes(2));
  release();
  const outcomes = await Promise.allSettled(pending);
  expect(outcomes.some((outcome) => outcome.status === "fulfilled" && outcome.value === "connected")).toBe(true);
  const connections = await list<Connection>(user.workspace_id, "connection");
  expect(connections).toHaveLength(1); expect(connections[0].accountId).toBe("account1");
});

it("persists rotated credentials and does not expose them in connection metadata", async () => {
  const current = await connected(); const result = await refreshSocialConnection(user.workspace_id, current.id);
  expect(JSON.stringify(result.connection)).not.toContain("rotated-access"); expect(JSON.stringify(result.connection)).not.toContain("rotated-refresh");
  const stored = (await query<{ encrypted: string }>("SELECT encrypted FROM credentials WHERE workspace_id=$1 AND provider=$2", [user.workspace_id, current.id]))[0];
  expect(stored.encrypted).not.toContain("rotated-access");
  expect(await decrypt(stored.encrypted)).toMatchObject({ token: "rotated-access", refreshToken: "rotated-refresh" });
  await expect(refreshSocialConnection(other.workspace_id, current.id)).rejects.toThrow(/Reconnect/);
});

it("serializes refresh and disconnect, and removes secrets even if revocation fails", async () => {
  const current = await connected();
  let release!: (value: SocialGrant) => void;
  const deferred = new Promise<SocialGrant>((resolve) => { release = resolve; });
  vi.mocked(xAdapter.refresh).mockReturnValueOnce(deferred);
  const refreshing = refreshSocialConnection(user.workspace_id, current.id);
  await vi.waitFor(() => expect(xAdapter.refresh).toHaveBeenCalledTimes(1));
  await expect(refreshSocialConnection(user.workspace_id, current.id)).rejects.toThrow(/being updated/);
  await expect(disconnectSocialConnection(user.workspace_id, "x", current.id)).rejects.toThrow(/being updated/);
  release(grant({ secret: { token: "rotated-access", refreshToken: "rotated-refresh" } })); await refreshing;
  vi.mocked(xAdapter.revoke).mockRejectedValueOnce(new Error("private token error"));
  const result = await disconnectSocialConnection(user.workspace_id, "x", current.id);
  expect(result).toMatchObject({ ok: true, revoked: false }); expect(JSON.stringify(result)).not.toContain("private token error");
  expect(await list(user.workspace_id, "connection")).toEqual([]);
  expect(await query("SELECT encrypted FROM credentials WHERE workspace_id=$1 AND provider=$2", [user.workspace_id, current.id])).toEqual([]);
});

it("invalidates an authorization pending when the account is disconnected", async () => {
  const current = await connected(); const pending = await begin();
  await disconnectSocialConnection(user.workspace_id, "x", current.id);
  await expect(finishSocialAuthorization(user, "x", cb(pending.state))).rejects.toThrow(/already used/);
  expect(await list(user.workspace_id, "connection")).toEqual([]);
  expect(xAdapter.exchange).toHaveBeenCalledTimes(1);
  const fresh = await begin();
  expect(await finishSocialAuthorization(user, "x", cb(fresh.state))).toBe("connected");
});

it("rejects an in-flight token exchange after disconnect and does not restore the account", async () => {
  const current = await connected(); const pending = await begin();
  let release!: (value: SocialGrant) => void;
  const deferred = new Promise<SocialGrant>((resolve) => { release = resolve; });
  vi.mocked(xAdapter.exchange).mockReturnValueOnce(deferred);
  const callback = finishSocialAuthorization(user, "x", cb(pending.state));
  await vi.waitFor(() => expect(xAdapter.exchange).toHaveBeenCalledTimes(2));
  await disconnectSocialConnection(user.workspace_id, "x", current.id);
  release(grant());
  await expect(callback).rejects.toThrow(/disconnected during authorization/);
  expect(await list(user.workspace_id, "connection")).toEqual([]);
  expect(await query("SELECT encrypted FROM credentials WHERE workspace_id=$1", [user.workspace_id])).toEqual([]);
});

it("serializes a different account callback with provider-wide disconnect", async () => {
  const current = await connected(); const pending = await begin();
  let release!: () => void;
  const revocation = new Promise<void>((resolve) => { release = resolve; });
  let releaseExchange!: (value: SocialGrant) => void;
  const exchange = new Promise<SocialGrant>((resolve) => { releaseExchange = resolve; });
  vi.mocked(xAdapter.revoke).mockReturnValueOnce(revocation);
  vi.mocked(xAdapter.exchange).mockReturnValueOnce(exchange);
  const callback = finishSocialAuthorization(user, "x", cb(pending.state));
  await vi.waitFor(() => expect(xAdapter.exchange).toHaveBeenCalledTimes(2));
  const disconnecting = disconnectSocialConnection(user.workspace_id, "x", current.id);
  await vi.waitFor(() => expect(xAdapter.revoke).toHaveBeenCalledTimes(1));
  releaseExchange(grant({ accountId: "other-account" }));
  await expect(callback).rejects.toThrow(/being updated|disconnected/);
  release(); await disconnecting;
  expect(await list(user.workspace_id, "connection")).toEqual([]);
});

it("flags other YouTube connections after Google grant revocation, within the workspace", async () => {
  vi.spyOn(youtubeAdapter, "configured").mockReturnValue(true);
  vi.spyOn(youtubeAdapter, "authorizationUrl").mockImplementation(({ state }) => `${origin}/mock?state=${state}`);
  vi.spyOn(youtubeAdapter, "revoke").mockResolvedValue();
  const ytGrant = (accountId: string): SocialGrant => ({ accountId, accountName: accountId, scopes: [...youtubeAdapter.requiredScopes], expiresAt: Date.now() + 3600_000, secret: { token: `token-${accountId}`, refreshToken: `refresh-${accountId}` } });
  vi.spyOn(youtubeAdapter, "exchange").mockResolvedValueOnce(ytGrant("channel-one")).mockResolvedValueOnce(ytGrant("channel-two")).mockResolvedValueOnce(ytGrant("foreign-channel"));
  const add = async (identity: Identity) => {
    const url = new URL(await beginSocialAuthorization(identity, "youtube", new Request(`${origin}/api/social/youtube/connect`, { method: "POST" })));
    await finishSocialAuthorization(identity, "youtube", cb(url.searchParams.get("state")!, "code=auth-code", "youtube"));
  };
  await add(user); await add(user); await add(other);
  const own = await list<Connection>(user.workspace_id, "connection");
  const first = own.find((item) => item.accountId === "channel-one")!;
  const result = await disconnectSocialConnection(user.workspace_id, "youtube", first.id);
  expect(result.revoked).toBe(true); expect(result.warning).toMatch(/other channels/);
  const remaining = await list<Connection>(user.workspace_id, "connection");
  expect(remaining).toHaveLength(1);
  expect(remaining[0]).toMatchObject({ accountId: "channel-two", requiresReconnect: true });
  expect(remaining[0].details).toMatch(/Google revocation/);
  expect((await list<Connection>(other.workspace_id, "connection"))[0].requiresReconnect).toBe(false);
});

it("returns only connection metadata from refresh and rejects a foreign workspace", async () => {
  const current = await connected();
  vi.spyOn(auth, "requireIdentity").mockResolvedValue(user);
  const request = () => new Request(`${origin}/api/social/x/refresh`, { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify({ connectionId: current.id }) });
  const context = { params: Promise.resolve({ provider: "x" }) };
  const response = await refreshRoute(request(), context);
  expect(response.status).toBe(200);
  const text = await response.text();
  expect(text).not.toContain("rotated-access"); expect(text).not.toContain("rotated-refresh");
  expect(JSON.parse(text).connection.id).toBe(current.id);
  vi.mocked(auth.requireIdentity).mockResolvedValue(other);
  expect((await refreshRoute(request(), context)).status).toBe(404);
});

it("redirects callback failures without reflecting codes or provider errors", async () => {
  const { state } = await begin(); vi.spyOn(auth, "requireIdentity").mockResolvedValue(user);
  vi.mocked(xAdapter.exchange).mockRejectedValueOnce(new Error("private-provider-token"));
  const response = await callbackRoute(cb(state, "code=sensitive-code"), { params: Promise.resolve({ provider: "x" }) });
  expect(response.status).toBe(303);
  expect(response.headers.get("location")).toBe(`${origin}/app?social=failed&provider=x`);
  expect(await response.text()).not.toContain("private-provider-token");
  expect(response.headers.get("location")).not.toContain("sensitive-code");
});
