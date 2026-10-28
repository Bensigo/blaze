import { socialJson, verifiedScopes, type SocialAdapter, type SocialGrant } from "./social-provider";
import type { ProviderSecret } from "./types";

const instagramScopes = ["instagram_business_basic", "instagram_business_content_publish"];
const tiktokScopes = ["user.info.basic", "video.publish"];
const failure = () => new Error("Provider authorization failed. Reconnect the account.");
const text = (value: unknown): string => typeof value === "string" && value.trim() ? value : "";
const id = (value: unknown): string => typeof value === "string" ? text(value) : typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? String(value) : "";
const scopes = (value: unknown): string[] => typeof value === "string" ? value.split(",").map((s) => s.trim()).filter(Boolean) : Array.isArray(value) && value.every((s) => typeof s === "string") ? value.map((s: string) => s.trim()).filter(Boolean) : [];
const expiry = (value: unknown): number => {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) throw failure();
  return Date.now() + value * 1000;
};
async function safeJson(url: string, init?: RequestInit): Promise<any> {
  try { return await socialJson(url, init); } catch { throw failure(); }
}
function form(values: Record<string, string>): RequestInit {
  return { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(values).toString() };
}
function igCredentials() {
  const clientId = text(process.env.INSTAGRAM_CLIENT_ID), clientSecret = text(process.env.INSTAGRAM_CLIENT_SECRET);
  if (!clientId || !clientSecret) throw new Error("Instagram app credentials are not configured.");
  return { clientId, clientSecret };
}
function ttCredentials() {
  const clientKey = text(process.env.TIKTOK_CLIENT_KEY), clientSecret = text(process.env.TIKTOK_CLIENT_SECRET);
  if (!clientKey || !clientSecret) throw new Error("TikTok app credentials are not configured.");
  return { clientKey, clientSecret };
}
async function instagramIdentity(token: string, expectedId: string) {
  const result = await safeJson("https://graph.instagram.com/v25.0/me?fields=user_id,username", { headers: { Authorization: `Bearer ${token}` } });
  const accountId = id(result?.user_id), accountName = text(result?.username);
  if (result?.error || !accountId || !accountName || accountId !== expectedId) throw failure();
  // The Instagram Login API is restricted to professional accounts. Reject a
  // non-professional type explicitly if a provider response happens to include it.
  if (result.account_type && !["BUSINESS", "CREATOR"].includes(result.account_type)) throw failure();
  return { accountId, accountName };
}
async function instagramGrant(token: string, expectedId: string, granted: string[], expiresAt: number): Promise<SocialGrant> {
  verifiedScopes(granted, instagramScopes);
  const identity = await instagramIdentity(token, expectedId);
  return { ...identity, scopes: granted, expiresAt, secret: { token, accountId: identity.accountId, expiresAt, scopes: granted } };
}
export const instagramAdapter: SocialAdapter = {
  provider: "instagram",
  requiredScopes: instagramScopes,
  configured: () => Boolean(text(process.env.INSTAGRAM_CLIENT_ID) && text(process.env.INSTAGRAM_CLIENT_SECRET)),
  setup: "Configure Instagram API with Instagram Login for a professional account, register the callback, and obtain the required permissions and app review where applicable.",
  authorizationUrl({ state, redirectUri }) {
    const { clientId } = igCredentials();
    const url = new URL("https://www.instagram.com/oauth/authorize");
    url.search = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, response_type: "code", scope: instagramScopes.join(","), state }).toString();
    return url.toString();
  },
  async exchange({ code, redirectUri }) {
    const { clientId, clientSecret } = igCredentials();
    const response = await safeJson("https://api.instagram.com/oauth/access_token", form({ client_id: clientId, client_secret: clientSecret, grant_type: "authorization_code", redirect_uri: redirectUri, code }));
    if (response?.error || (response?.data && (response.access_token || !Array.isArray(response.data) || response.data.length !== 1))) throw failure();
    const short = response?.data ? response.data[0] : response;
    const token = text(short?.access_token), accountId = id(short?.user_id), granted = scopes(short?.permissions);
    if (!token || !accountId) throw failure();
    verifiedScopes(granted, instagramScopes);
    const url = new URL("https://graph.instagram.com/access_token");
    url.search = new URLSearchParams({ grant_type: "ig_exchange_token", client_secret: clientSecret, access_token: token }).toString();
    const long = await safeJson(url.toString());
    const longToken = text(long?.access_token);
    if (long?.error || !longToken) throw failure();
    return instagramGrant(longToken, accountId, granted, expiry(long.expires_in));
  },
  async refresh(secret) {
    const token = text(secret.token), accountId = id(secret.accountId), granted = scopes(secret.scopes);
    if (!token || !accountId) throw failure();
    verifiedScopes(granted, instagramScopes);
    const url = new URL("https://graph.instagram.com/refresh_access_token");
    url.search = new URLSearchParams({ grant_type: "ig_refresh_token", access_token: token }).toString();
    const response = await safeJson(url.toString());
    const next = text(response?.access_token);
    if (response?.error || !next) throw failure();
    return instagramGrant(next, accountId, granted, expiry(response.expires_in));
  },
  async revoke() {
    // No verified Instagram Login revocation endpoint; do not pretend local deletion revokes access.
    throw new Error("Remove this app from Instagram's connected apps to revoke access.");
  },
};

async function tiktokGrant(response: any, previous?: ProviderSecret): Promise<SocialGrant> {
  const token = text(response?.access_token), accountId = id(response?.open_id);
  const refreshToken = text(response?.refresh_token) || text(previous?.refreshToken);
  const granted = scopes(response?.scope);
  if (response?.error || !token || !accountId || !refreshToken || (previous?.accountId && accountId !== previous.accountId)) throw failure();
  verifiedScopes(granted, tiktokScopes);
  const expiresAt = expiry(response.expires_in);
  const profile = await safeJson("https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name", { headers: { Authorization: `Bearer ${token}` } });
  const user = profile?.data?.user;
  const accountName = text(user?.display_name);
  if (profile?.error?.code !== "ok" || id(user?.open_id) !== accountId || !accountName) throw failure();
  return { accountId, accountName, scopes: granted, expiresAt, secret: { token, accountId, refreshToken, expiresAt, scopes: granted } };
}
export const tiktokAdapter: SocialAdapter = {
  provider: "tiktok",
  requiredScopes: tiktokScopes,
  configured: () => Boolean(text(process.env.TIKTOK_CLIENT_KEY) && text(process.env.TIKTOK_CLIENT_SECRET)),
  setup: "Register a TikTok app and HTTPS callback, enable Login Kit and Direct Post, and obtain approval for user.info.basic and video.publish. Per-post consent is required; public Direct Post also requires an audit.",
  authorizationUrl({ state, redirectUri }) {
    const { clientKey } = ttCredentials();
    const url = new URL("https://www.tiktok.com/v2/auth/authorize/");
    url.search = new URLSearchParams({ client_key: clientKey, redirect_uri: redirectUri, response_type: "code", scope: tiktokScopes.join(","), state }).toString();
    return url.toString();
  },
  async exchange({ code, redirectUri }) {
    const { clientKey, clientSecret } = ttCredentials();
    const response = await safeJson("https://open.tiktokapis.com/v2/oauth/token/", form({ client_key: clientKey, client_secret: clientSecret, grant_type: "authorization_code", code, redirect_uri: redirectUri }));
    return tiktokGrant(response);
  },
  async refresh(secret) {
    const { clientKey, clientSecret } = ttCredentials(), refreshToken = text(secret.refreshToken);
    if (!refreshToken || !text(secret.accountId)) throw failure();
    const response = await safeJson("https://open.tiktokapis.com/v2/oauth/token/", form({ client_key: clientKey, client_secret: clientSecret, grant_type: "refresh_token", refresh_token: refreshToken }));
    return tiktokGrant(response, secret);
  },
  async revoke(secret) {
    const { clientKey, clientSecret } = ttCredentials(), token = text(secret.token);
    if (!token) throw failure();
    const response = await safeJson("https://open.tiktokapis.com/v2/oauth/revoke/", form({ client_key: clientKey, client_secret: clientSecret, token }));
    if (response?.error && response.error?.code !== "ok") throw failure();
  },
};
