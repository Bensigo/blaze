import { randomBytes } from "node:crypto";
import { get, id, list, query } from "./db";
import { HttpError } from "./http-error";
import { requireXFeedbackBudget, matchesXApprovedAccount, reserveXIdentity, finishXAttempt } from "./x-feedback-policy";
import type { Identity } from "./auth";
import { constantEqual, decrypt, encrypt, hash } from "./security";
import { appOrigin, canonicalRequestUrl } from "./app-origin";
import { isSocialProvider, socialProviders, type SocialAdapter, type SocialGrant, type SocialProvider } from "./social-provider";
import { xAdapter, xFeedbackAdapter, youtubeAdapter } from "./social-x-youtube";
import { instagramAdapter, tiktokAdapter } from "./social-instagram-tiktok";
import type { Connection, ProviderSecret } from "./types";

// Background credential refresh does not need Next's request-cookie API.
// Cache the module, never a request's cookie jar.
let cookieApi: Promise<typeof import("next/headers")> | undefined;
async function cookies() { return (await (cookieApi ??= import("next/headers"))).cookies(); }

const adapters: Record<SocialProvider, SocialAdapter> = { x: xAdapter, x_feedback: xFeedbackAdapter, youtube: youtubeAdapter, instagram: instagramAdapter, tiktok: tiktokAdapter };
const secure = () => process.env.NODE_ENV === "production" || !!process.env.VERCEL;
const cookieName = (state: string) => `blaze_social_${hash(state).slice(0, 24)}`;
type Pending = { id: string; userId: string; provider: SocialProvider; redirectUri: string; expiresAt: string; verifier: string; epoch: string; connectionId?: string; accountId?: string; xReceiptNonce?: string };
async function authorizationEpoch(workspace: string, provider: string) {
  return (await get<{ id: string; value: string }>(workspace, "social_oauth_epoch", provider))?.value || "initial";
}
export function socialAdapter(provider: string) {
  if (!isSocialProvider(provider)) throw new HttpError(404, "Unsupported social provider.");
  return adapters[provider];
}
export function socialConfiguration(origin: string) {
  return socialProviders.map((provider) => ({ provider, configured: adapters[provider].configured(), setup: adapters[provider].setup, callbackUrl: `${origin}/api/social/${provider}/callback` }));
}
async function rawSecret(workspace: string, connectionId: string): Promise<ProviderSecret | undefined> {
  const row = (await query<{ encrypted: string }>("SELECT encrypted FROM credentials WHERE workspace_id=$1 AND provider=$2", [workspace, connectionId]))[0];
  return row ? decrypt(row.encrypted) : undefined;
}
function safeConnection(current: Connection | undefined, adapter: SocialAdapter, grant: SocialGrant): Connection {
  if (!grant.accountId || !grant.accountName || !grant.secret.token || adapter.requiredScopes.some((scope) => !grant.scopes.includes(scope)))
    throw new HttpError(400, "Provider identity or publishing permissions could not be verified.");
  if (grant.expiresAt !== undefined && (!Number.isFinite(grant.expiresAt) || grant.expiresAt <= Date.now()))
    throw new HttpError(400, "Provider returned an expired account authorization.");
  return {
    id: current?.id || id("conn"), provider: adapter.provider, label: grant.accountName.slice(0, 200), accountName: grant.accountName.slice(0, 200), accountId: grant.accountId,
    authMethod: "oauth", connected: true, checkedAt: new Date().toISOString(), scopes: grant.scopes,
    expiresAt: grant.expiresAt ? new Date(grant.expiresAt).toISOString() : undefined, requiresReconnect: false,
    details: adapter.provider === "x_feedback" ? "Read-only identity and scopes verified; search entitlement and cost are not tested." : "Identity and requested publishing permissions verified through official authorization. Platform publishing approval is checked separately.",
  };
}
async function persistGrant(workspace: string, current: Connection | undefined, adapter: SocialAdapter, grant: SocialGrant) {
  const next = safeConnection(current, adapter, grant);
  const secret = { ...grant.secret, accountId: grant.accountId, scopes: grant.scopes, expiresAt: grant.expiresAt, authMethod: "oauth" };
  const encrypted = await encrypt(secret);
  const saved = current
    ? await query<{ body: Connection }>(`WITH saved AS (UPDATE records SET body=$4::jsonb,updated_at=now() WHERE workspace_id=$1 AND kind='connection' AND id=$2 AND body=$3::jsonb RETURNING body), credential AS (INSERT INTO credentials(workspace_id,provider,encrypted) SELECT $1,$2,$5 FROM saved ON CONFLICT(workspace_id,provider) DO UPDATE SET encrypted=excluded.encrypted RETURNING provider) SELECT saved.body FROM saved JOIN credential ON true`, [workspace, next.id, JSON.stringify(current), JSON.stringify(next), encrypted])
    : await query<{ body: Connection }>(`WITH saved AS (INSERT INTO records(workspace_id,kind,id,body) VALUES($1,'connection',$2,$3::jsonb) ON CONFLICT DO NOTHING RETURNING body), credential AS (INSERT INTO credentials(workspace_id,provider,encrypted) SELECT $1,$2,$4 FROM saved ON CONFLICT(workspace_id,provider) DO UPDATE SET encrypted=excluded.encrypted RETURNING provider) SELECT saved.body FROM saved JOIN credential ON true`, [workspace, next.id, JSON.stringify(next), encrypted]);
  if (!saved.length) throw new HttpError(409, "The connection changed. Reconnect to verify its current authorization.");
  return { connection: saved[0].body, secret };
}
export async function beginSocialAuthorization(user: Identity, provider: string, request: Request, connectionId?: string) {
  const adapter = socialAdapter(provider);
  if (!adapter.configured()) throw new HttpError(503, adapter.setup);
  const origin = appOrigin(request);
  if (!origin || !canonicalRequestUrl(request)) throw new HttpError(400, "Open the canonical Blaze app URL to connect an account.");
  const current = connectionId ? await get<Connection>(user.workspace_id, "connection", connectionId) : undefined;
  if (connectionId && (!current || current.provider !== provider)) throw new HttpError(404, "Connection not found.");
  const xReceiptNonce = provider === "x_feedback" ? await requireXFeedbackBudget(user.workspace_id, "identity") : undefined;
  const state = randomBytes(32).toString("base64url"), verifier = randomBytes(48).toString("base64url");
  const pending: Pending = { id: hash(state), userId: user.id, provider: adapter.provider, redirectUri: `${origin}/api/social/${provider}/callback`, expiresAt: new Date(Date.now() + 600000).toISOString(), verifier: await encrypt({ token: verifier }), epoch: await authorizationEpoch(user.workspace_id, provider), ...(current ? { connectionId: current.id, accountId: current.accountId } : {}), ...(xReceiptNonce ? { xReceiptNonce } : {}) };
  await query("DELETE FROM records WHERE workspace_id=$1 AND kind='social_oauth_state' AND (body->>'expiresAt')::timestamptz<now()", [user.workspace_id]);
  await query("INSERT INTO records(workspace_id,kind,id,body) VALUES($1,'social_oauth_state',$2,$3::jsonb)", [user.workspace_id, pending.id, JSON.stringify(pending)]);
  (await cookies()).set(cookieName(state), hash(state), { httpOnly: true, secure: secure(), sameSite: "lax", path: "/api/social", maxAge: 600 });
  const challenge = Buffer.from(hash(verifier), "hex").toString("base64url");
  return adapter.authorizationUrl({ state, challenge, redirectUri: pending.redirectUri });
}
export async function finishSocialAuthorization(user: Identity, provider: string, request: Request) {
  const adapter = socialAdapter(provider), url = canonicalRequestUrl(request);
  if (!url) throw new HttpError(403, "Open the canonical Blaze app URL to connect an account.");
  const state = url.searchParams.get("state") || "";
  if (!/^[a-zA-Z0-9_-]{43}$/.test(state)) throw new HttpError(400, "Invalid or expired authorization state.");
  const jar = await cookies(), name = cookieName(state), bound = jar.get(name)?.value || "";
  jar.set(name, "", { path: "/api/social", httpOnly: true, secure: secure(), sameSite: "lax", maxAge: 0 });
  if (!constantEqual(bound, hash(state))) throw new HttpError(403, "This authorization belongs to another browser session.");
  const row = (await query<{ body: Pending }>(`DELETE FROM records WHERE workspace_id=$1 AND kind='social_oauth_state' AND id=$2 AND body->>'userId'=$3 AND body->>'provider'=$4 AND (body->>'expiresAt')::timestamptz>now() RETURNING body`, [user.workspace_id, hash(state), user.id, provider]))[0];
  if (!row || url.origin !== appOrigin(request) || `${url.origin}${url.pathname}` !== row.body.redirectUri) throw new HttpError(403, "Invalid, expired or already used authorization state.");
  if (url.searchParams.has("error")) return "denied";
  const code = url.searchParams.get("code");
  if (!code || code.length > 4096) throw new HttpError(400, "Provider did not return an authorization code.");
  let dispatched = false, settled = false;
  const nonce = row.body.xReceiptNonce;
  if (provider === "x_feedback") { if (!nonce) throw new HttpError(403, "X approval is missing."); await reserveXIdentity(user.workspace_id, nonce); }
  let grant: SocialGrant;
  try { grant = await adapter.exchange({ code, verifier: (await decrypt(row.body.verifier)).token, redirectUri: row.body.redirectUri, ...(provider === "x_feedback" && nonce ? { beforeIdentity: async () => { await requireXFeedbackBudget(user.workspace_id, "identity", { nonce }, true); dispatched = true; } } : {}) }); settled = true; }
  finally { if (provider === "x_feedback" && nonce) await finishXAttempt(user.workspace_id, nonce, "identity", dispatched, settled); }
  if (provider === "x_feedback" && (!row.body.xReceiptNonce || !await matchesXApprovedAccount(user.workspace_id, row.body.xReceiptNonce, grant.accountId))) return "account_mismatch";
  if (row.body.accountId && grant.accountId !== row.body.accountId) {
    // Google revocation can remove the entire project's grant, including other channels.
    // Discard the unintended credentials without revoking the user's existing grant.
    return "account_mismatch";
  }
  // Two independent authorizations for one account must resolve to one connection.
  await withConnectionLease(user.workspace_id, `provider:${provider}`, async () => {
    if (row.body.epoch !== await authorizationEpoch(user.workspace_id, provider))
      throw new HttpError(409, "An account was disconnected during authorization. Start a new connection explicitly.");
    const current = row.body.connectionId
      ? await get<Connection>(user.workspace_id, "connection", row.body.connectionId)
      : (await list<Connection>(user.workspace_id, "connection")).find((c) => c.provider === provider && c.accountId === grant.accountId);
    if (row.body.connectionId && (!current || current.provider !== provider || current.accountId !== row.body.accountId))
      throw new HttpError(409, "The connection changed during authorization. Start again.");
    await persistGrant(user.workspace_id, current, adapter, grant);
  });
  return "connected";
}
async function withConnectionLease<T>(workspace: string, connectionId: string, run: () => Promise<T>): Promise<T> {
  const nonce = randomBytes(16).toString("hex"), body = JSON.stringify({ nonce, until: new Date(Date.now() + 120000).toISOString() });
  const lease = await query(`INSERT INTO records(workspace_id,kind,id,body) VALUES($1,'social_refresh_lease',$2,$3::jsonb) ON CONFLICT(workspace_id,kind,id) DO UPDATE SET body=excluded.body,updated_at=now() WHERE (records.body->>'until')::timestamptz<now() RETURNING id`, [workspace, connectionId, body]);
  if (!lease.length) throw new HttpError(409, "This connection is being updated. Try again shortly.");
  try { return await run(); } finally {
    await query("DELETE FROM records WHERE workspace_id=$1 AND kind='social_refresh_lease' AND id=$2 AND body->>'nonce'=$3", [workspace, connectionId, nonce]);
  }
}
export async function refreshSocialConnection(workspace: string, connectionId: string, automatic = false) {
  return withConnectionLease(workspace, connectionId, async () => {
    const current = await get<Connection>(workspace, "connection", connectionId);
    if (!current || current.authMethod !== "oauth" || !current.connected) throw new HttpError(400, "Reconnect this account through its provider first.");
    let xNonce: string | undefined;
    if (current.provider === "x_feedback") { if (!current.accountId) throw new HttpError(403, "X account identity is missing."); if (automatic) throw new HttpError(403, "Automatic X feedback refresh is disabled."); xNonce = await requireXFeedbackBudget(workspace, "identity", { accountId: current.accountId }); }
    const secret = await rawSecret(workspace, connectionId);
    if (!secret) { if (xNonce) await finishXAttempt(workspace, xNonce, "identity", false, false); throw new HttpError(400, "Reconnect this account through its provider first."); }
    if (automatic && (!current.expiresAt || new Date(current.expiresAt).getTime() > Date.now() + 300000)) return { connection: current, secret };
    const adapter = socialAdapter(current.provider);
    if (xNonce) await reserveXIdentity(workspace, xNonce);
    let dispatched = false, settled = false;
    try {
      const grant = await adapter.refresh(secret, xNonce ? async () => { await requireXFeedbackBudget(workspace, "identity", { nonce: xNonce, accountId: current.accountId }, true); dispatched = true; } : undefined);
      settled = true;
      if (grant.accountId !== current.accountId) throw new Error("Provider refreshed a different account. Reconnect the original destination.");
      return await persistGrant(workspace, current, adapter, grant);
    } catch (error) {
      const details = "Account refresh failed. Reconnect through the provider to verify permissions and expiry.";
      await query("UPDATE records SET body=$4::jsonb,updated_at=now() WHERE workspace_id=$1 AND kind='connection' AND id=$2 AND body=$3::jsonb", [workspace, connectionId, JSON.stringify(current), JSON.stringify({ ...current, requiresReconnect: true, details })]);
      throw new HttpError(400, error instanceof HttpError ? error.message : details);
    } finally { if (xNonce) await finishXAttempt(workspace, xNonce, "identity", dispatched, settled); }
  });
}
export async function freshSocialSecret(workspace: string, connection: Connection, secret: ProviderSecret) {
  if (connection.requiresReconnect) throw new HttpError(400, "Reconnect the approved destination account before continuing.");
  if (!connection.expiresAt || new Date(connection.expiresAt).getTime() > Date.now() + 300000) return secret;
  return (await refreshSocialConnection(workspace, connection.id, true)).secret;
}
export async function disconnectSocialConnection(workspace: string, provider: string, connectionId: string) {
  const adapter = socialAdapter(provider);
  return withConnectionLease(workspace, connectionId, async () => {
    const current = await get<Connection>(workspace, "connection", connectionId);
    if (!current || current.provider !== provider) throw new HttpError(404, "Connection not found.");
    const secret = await rawSecret(workspace, connectionId);
    return withConnectionLease(workspace, `provider:${provider}`, async () => {
      // Invalidate pending authorizations, including a code exchange already in flight.
      const epoch = JSON.stringify({ id: provider, value: randomBytes(16).toString("hex") });
      await query(`WITH epoch AS (INSERT INTO records(workspace_id,kind,id,body) VALUES($1,'social_oauth_epoch',$3,$4::jsonb) ON CONFLICT(workspace_id,kind,id) DO UPDATE SET body=excluded.body,updated_at=now()), pending AS (DELETE FROM records WHERE workspace_id=$1 AND kind='social_oauth_state' AND body->>'provider'=$3), removed AS (DELETE FROM records WHERE workspace_id=$1 AND kind='connection' AND id=$2 RETURNING id) DELETE FROM credentials WHERE workspace_id=$1 AND provider IN (SELECT id FROM removed)`, [workspace, connectionId, provider, epoch]);
      let revoked = false;
      if (secret && current.authMethod === "oauth") {
        try { await adapter.revoke(secret); revoked = true; } catch { /* Local authorization is already removed. */ }
      }
      if (provider === "youtube" && revoked) {
        await query(`UPDATE records SET body=body || $2::jsonb,updated_at=now() WHERE workspace_id=$1 AND kind='connection' AND body->>'provider'='youtube' AND body->>'authMethod'='oauth'`, [workspace, JSON.stringify({ requiresReconnect: true, details: "Google revocation may affect other channels authorized by the same Google account. Reconnect to verify this destination." })]);
      }
      return { ok: true, revoked, ...(revoked ? (provider === "youtube" ? { warning: "Disconnected and revoked. Google can also revoke this application's access to other channels on the same Google account; remaining YouTube connections need verification." } : {}) : { warning: "Disconnected from Blaze. Provider revocation could not be confirmed; remove Blaze access in the provider's account settings." }) };
    });
  });
}
