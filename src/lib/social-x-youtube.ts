import type { ProviderSecret } from "./types";
import { socialJson, verifiedScopes, type SocialAdapter, type SocialGrant } from "./social-provider";

const xScopes = ["tweet.read", "tweet.write", "users.read", "offline.access", "media.write"];
const youtubeScopes = ["https://www.googleapis.com/auth/youtube.upload", "https://www.googleapis.com/auth/youtube.readonly"];

function credentials(provider: "x" | "youtube") {
  const id = process.env[provider === "x" ? "X_CLIENT_ID" : "YOUTUBE_CLIENT_ID"];
  const secret = process.env[provider === "x" ? "X_CLIENT_SECRET" : "YOUTUBE_CLIENT_SECRET"];
  if (!id || !secret) throw new Error("Social provider OAuth credentials are not configured.");
  return { id, secret };
}
function configured(provider: "x" | "youtube") {
  try { credentials(provider); return true; } catch { return false; }
}
function formRequest(body: Record<string, string>, headers: Record<string, string> = {}): RequestInit {
  return { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", ...headers }, body: new URLSearchParams(body).toString() };
}
function xBasic() {
  const { id, secret } = credentials("x");
  // OAuth client credentials are form-encoded before forming the Basic credential.
  const encode = (s: string) => new URLSearchParams({ v: s }).toString().slice(2);
  return `Basic ${Buffer.from(`${encode(id)}:${encode(secret)}`).toString("base64")}`;
}
async function request(url: string, init: RequestInit) {
  try { return await socialJson(url, init); }
  catch { throw new Error("Provider authorization failed. Reconnect the account and try again."); }
}
function tokenString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() && !/[\r\n]/.test(value) ? value : undefined;
}
function parseToken(data: any, required: string[], previous?: ProviderSecret) {
  const token = tokenString(data?.access_token);
  const refreshToken = tokenString(data?.refresh_token) || tokenString(previous?.refreshToken);
  if (!token || !refreshToken) throw new Error("Provider did not return usable offline credentials. Reconnect the account.");
  const returned = typeof data?.scope === "string" ? data.scope.trim().split(/\s+/).filter(Boolean) : undefined;
  // OAuth refresh responses may omit scope when unchanged; only reuse scopes previously verified at exchange.
  const previousScopes = Array.isArray(previous?.scopes) && previous.scopes.every((scope: unknown) => typeof scope === "string") ? previous.scopes as string[] : [];
  const scopes = verifiedScopes(returned ?? previousScopes, required);
  const seconds = data?.expires_in;
  if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds <= 0 || seconds > 31536000) throw new Error("Provider returned an invalid token expiry. Reconnect the account.");
  const expiresAt = Date.now() + seconds * 1000;
  return { token, refreshToken, scopes, expiresAt };
}
function validIdentity(id: unknown, name: unknown) {
  if (typeof id !== "string" || !id.trim() || id.length > 256 || typeof name !== "string" || !name.trim() || name.length > 500) {
    throw new Error("Provider did not return a valid account identity. Reconnect the account.");
  }
  return { accountId: id, accountName: name.trim() };
}
async function makeGrant(provider: "x" | "youtube", data: any, previous?: ProviderSecret): Promise<SocialGrant> {
  const parsed = parseToken(data, provider === "x" ? xScopes : youtubeScopes, previous);
  let identity: { accountId: string; accountName: string };
  if (provider === "x") {
    const result = await request("https://api.x.com/2/users/me", { headers: { Authorization: `Bearer ${parsed.token}` } });
    identity = validIdentity(result?.data?.id, result?.data?.name);
  } else {
    const result = await request("https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true&maxResults=50", { headers: { Authorization: `Bearer ${parsed.token}` } });
    if (!Array.isArray(result?.items) || result.items.length !== 1 || result.nextPageToken || (typeof result.pageInfo?.totalResults === "number" && result.pageInfo.totalResults !== 1)) {
      throw new Error("A single YouTube channel could not be verified. Reconnect using the intended channel.");
    }
    identity = validIdentity(result.items[0]?.id, result.items[0]?.snippet?.title);
  }
  if (previous?.accountId && previous.accountId !== identity.accountId) throw new Error("Provider account identity changed. Reconnect the account.");
  const secret: ProviderSecret = { token: parsed.token, refreshToken: parsed.refreshToken, expiresAt: parsed.expiresAt, accountId: identity.accountId, scopes: parsed.scopes };
  return { ...identity, secret, scopes: parsed.scopes, expiresAt: parsed.expiresAt };
}
function authorize(provider: "x" | "youtube", input: { state: string; challenge: string; redirectUri: string }) {
  const { id } = credentials(provider);
  const url = new URL(provider === "x" ? "https://x.com/i/oauth2/authorize" : "https://accounts.google.com/o/oauth2/v2/auth");
  const params: Record<string, string> = { response_type: "code", client_id: id, redirect_uri: input.redirectUri, state: input.state, scope: (provider === "x" ? xScopes : youtubeScopes).join(" "), code_challenge: input.challenge, code_challenge_method: "S256" };
  if (provider === "youtube") Object.assign(params, { access_type: "offline", prompt: "consent" });
  url.search = new URLSearchParams(params).toString();
  return url.toString();
}
async function exchange(provider: "x" | "youtube", input: { code: string; verifier: string; redirectUri: string }) {
  const { id, secret } = credentials(provider);
  const common = { grant_type: "authorization_code", code: input.code, redirect_uri: input.redirectUri, code_verifier: input.verifier };
  const data = provider === "x"
    ? await request("https://api.x.com/2/oauth2/token", formRequest(common, { Authorization: xBasic() }))
    : await request("https://oauth2.googleapis.com/token", formRequest({ ...common, client_id: id, client_secret: secret }));
  return makeGrant(provider, data);
}
async function refresh(provider: "x" | "youtube", previous: ProviderSecret) {
  const refreshToken = tokenString(previous.refreshToken);
  if (!refreshToken || !previous.accountId) throw new Error("Offline credentials are missing. Reconnect the account.");
  const { id, secret } = credentials(provider);
  const body = { grant_type: "refresh_token", refresh_token: refreshToken };
  const data = provider === "x"
    ? await request("https://api.x.com/2/oauth2/token", formRequest(body, { Authorization: xBasic() }))
    : await request("https://oauth2.googleapis.com/token", formRequest({ ...body, client_id: id, client_secret: secret }));
  return makeGrant(provider, data, previous);
}
async function revoke(provider: "x" | "youtube", secret: ProviderSecret) {
  const token = tokenString(secret.refreshToken) || tokenString(secret.token);
  if (!token) throw new Error("Provider credentials are missing.");
  if (provider === "x") {
    // X documents each revocation as invalidating the supplied token, so revoke both.
    const accessToken = tokenString(secret.token);
    const refreshToken = tokenString(secret.refreshToken);
    const targets = [...new Set([accessToken, refreshToken].filter((value): value is string => !!value))];
    let failed = false;
    for (const value of targets) {
      try { await request("https://api.x.com/2/oauth2/revoke", formRequest({ token: value }, { Authorization: xBasic() })); }
      catch { failed = true; }
    }
    if (failed) throw new Error("Provider authorization failed. Reconnect the account and try again.");
  } else await request("https://oauth2.googleapis.com/revoke", formRequest({ token }));
}

export const xAdapter: SocialAdapter = {
  provider: "x", requiredScopes: xScopes, configured: () => configured("x"),
  setup: "Configure an X developer web app with OAuth 2.0, the exact callback URL, X_CLIENT_ID and X_CLIENT_SECRET, and the necessary API access.",
  authorizationUrl: (input) => authorize("x", input), exchange: (input) => exchange("x", input), refresh: (secret) => refresh("x", secret), revoke: (secret) => revoke("x", secret),
};
export const youtubeAdapter: SocialAdapter = {
  provider: "youtube", requiredScopes: youtubeScopes, configured: () => configured("youtube"),
  setup: "Enable YouTube Data API, configure a Google web OAuth client and consent screen with the exact callback URL, YOUTUBE_CLIENT_ID and YOUTUBE_CLIENT_SECRET; complete applicable verification and API audits.",
  authorizationUrl: (input) => authorize("youtube", input), exchange: (input) => exchange("youtube", input), refresh: (secret) => refresh("youtube", secret), revoke: (secret) => revoke("youtube", secret),
};
