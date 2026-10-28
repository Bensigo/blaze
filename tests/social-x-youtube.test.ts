import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { xAdapter, youtubeAdapter } from "../src/lib/social-x-youtube";

const input = { state: "state-value", challenge: "challenge-value", redirectUri: "https://app.example/callback", code: "code-value", verifier: "verifier-value" };
const xScope = xAdapter.requiredScopes.join(" ");
const youtubeScope = youtubeAdapter.requiredScopes.join(" ");
const tokens = (scope: string) => ({ access_token: "access-value", refresh_token: "refresh-value", expires_in: 7200, scope });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const xIdentity = () => json({ data: { id: "123", name: "X account" } });
const youtubeIdentity = () => json({ items: [{ id: "channel-id", snippet: { title: "Channel name" } }], pageInfo: { totalResults: 1 } });

beforeEach(() => {
  vi.stubEnv("X_CLIENT_ID", "x-client"); vi.stubEnv("X_CLIENT_SECRET", "x-secret");
  vi.stubEnv("YOUTUBE_CLIENT_ID", "google-client"); vi.stubEnv("YOUTUBE_CLIENT_SECRET", "google-secret");
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe.each([xAdapter, youtubeAdapter])("$provider OAuth", (adapter) => {
  it("builds an authorization URL with state, scopes, and S256 PKCE", () => {
    const url = new URL(adapter.authorizationUrl(input));
    expect(url.searchParams.get("state")).toBe(input.state);
    expect(url.searchParams.get("redirect_uri")).toBe(input.redirectUri);
    expect(url.searchParams.get("code_challenge")).toBe(input.challenge);
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("scope")?.split(" ")).toEqual(adapter.requiredScopes);
    if (adapter.provider === "youtube") expect(url.searchParams.get("access_type")).toBe("offline");
  });
  it("fails closed for missing granted scopes, tokens, or valid identities", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(json(tokens("inadequate")));
    vi.stubGlobal("fetch", fetchMock);
    await expect(adapter.exchange(input)).rejects.toThrow("permissions");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fetchMock.mockResolvedValueOnce(json({ access_token: "a", scope: adapter.requiredScopes.join(" "), expires_in: 3600 }));
    await expect(adapter.exchange(input)).rejects.toThrow("offline credentials");
    fetchMock.mockResolvedValueOnce(json(tokens(adapter.requiredScopes.join(" ")))).mockResolvedValueOnce(json(adapter.provider === "x" ? { data: { id: "", name: "x" } } : { items: [{ id: "id", snippet: {} }] }));
    await expect(adapter.exchange(input)).rejects.toThrow("identity");
  });
  it("does not leak provider error text", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("access-value secret", { status: 401 })));
    await expect(adapter.exchange(input)).rejects.toThrow("Provider authorization failed. Reconnect the account and try again.");
  });
});

it("exchanges and refreshes X confidential-client tokens with the verifier, rotation and verified identity", async () => {
  const mock = vi.fn().mockResolvedValueOnce(json(tokens(xScope))).mockResolvedValueOnce(xIdentity())
    .mockResolvedValueOnce(json({ ...tokens(xScope), access_token: "new-access", refresh_token: "rotated" })).mockResolvedValueOnce(xIdentity())
    .mockResolvedValueOnce(new Response(null, { status: 200 })).mockResolvedValueOnce(new Response(null, { status: 200 }));
  vi.stubGlobal("fetch", mock);
  const grant = await xAdapter.exchange(input);
  expect(grant).toMatchObject({ accountId: "123", accountName: "X account", scopes: xAdapter.requiredScopes, secret: { token: "access-value", refreshToken: "refresh-value" } });
  const [url, init] = mock.mock.calls[0];
  expect(url).toBe("https://api.x.com/2/oauth2/token");
  expect(new URLSearchParams(init.body).get("code_verifier")).toBe(input.verifier);
  expect(init.headers.Authorization).toBe(`Basic ${Buffer.from("x-client:x-secret").toString("base64")}`);
  expect(mock.mock.calls[1][1].headers.Authorization).toBe("Bearer access-value");
  const refreshed = await xAdapter.refresh(grant.secret);
  expect(refreshed.secret).toMatchObject({ token: "new-access", refreshToken: "rotated", accountId: "123" });
  expect(new URLSearchParams(mock.mock.calls[2][1].body).get("refresh_token")).toBe("refresh-value");
  await xAdapter.revoke(refreshed.secret);
  expect(mock.mock.calls[4][0]).toBe("https://api.x.com/2/oauth2/revoke");
  expect(new URLSearchParams(mock.mock.calls[4][1].body).get("token")).toBe("new-access");
  expect(new URLSearchParams(mock.mock.calls[5][1].body).get("token")).toBe("rotated");
});

it("exchanges Google credentials, verifies one channel, retains a refresh token and revokes it", async () => {
  const mock = vi.fn().mockResolvedValueOnce(json(tokens(youtubeScope))).mockResolvedValueOnce(youtubeIdentity())
    .mockResolvedValueOnce(json({ access_token: "new-access", expires_in: 3600, scope: youtubeScope })).mockResolvedValueOnce(youtubeIdentity())
    .mockResolvedValueOnce(new Response(null, { status: 200 }));
  vi.stubGlobal("fetch", mock);
  const grant = await youtubeAdapter.exchange(input);
  expect(grant).toMatchObject({ accountId: "channel-id", accountName: "Channel name", secret: { refreshToken: "refresh-value" } });
  const body = new URLSearchParams(mock.mock.calls[0][1].body);
  expect(mock.mock.calls[0][0]).toBe("https://oauth2.googleapis.com/token");
  expect(body.get("client_secret")).toBe("google-secret"); expect(body.get("code_verifier")).toBe(input.verifier);
  expect(mock.mock.calls[1][0]).toBe("https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true&maxResults=50");
  const refreshed = await youtubeAdapter.refresh(grant.secret);
  expect(refreshed.secret.refreshToken).toBe("refresh-value");
  await youtubeAdapter.revoke(refreshed.secret);
  expect(mock.mock.calls[4][0]).toBe("https://oauth2.googleapis.com/revoke");
  expect(new URLSearchParams(mock.mock.calls[4][1].body).get("token")).toBe("refresh-value");
});

it.each([
  { items: [] },
  { items: [{ id: "a", snippet: { title: "A" } }, { id: "b", snippet: { title: "B" } }] },
  { items: [{ id: "a", snippet: { title: "A" } }], nextPageToken: "next" },
])("rejects ambiguous YouTube results", async (response) => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(json(tokens(youtubeScope))).mockResolvedValueOnce(json(response)));
  await expect(youtubeAdapter.exchange(input)).rejects.toThrow("single YouTube channel");
});

it("rejects a refreshed identity that no longer matches the connected account", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(json(tokens(xScope))).mockResolvedValueOnce(json({ data: { id: "different", name: "Other" } })));
  await expect(xAdapter.refresh({ token: "old", refreshToken: "refresh", accountId: "123", scopes: xAdapter.requiredScopes })).rejects.toThrow("identity changed");
});

it("only reuses previously verified scopes when a refresh response omits scope", async () => {
  const response = { access_token: "new", expires_in: 3600 };
  const mock = vi.fn().mockResolvedValueOnce(json(response)).mockResolvedValueOnce(xIdentity()).mockResolvedValueOnce(json(response));
  vi.stubGlobal("fetch", mock);
  const grant = await xAdapter.refresh({ token: "old", refreshToken: "refresh", accountId: "123", scopes: xAdapter.requiredScopes });
  expect(grant.scopes).toEqual(xAdapter.requiredScopes);
  expect(grant.secret.refreshToken).toBe("refresh");
  await expect(xAdapter.refresh({ token: "old", refreshToken: "refresh", accountId: "123" })).rejects.toThrow("permissions");
});

it("attempts to revoke both X tokens and reports partial failure", async () => {
  const mock = vi.fn().mockResolvedValueOnce(new Response("secret", { status: 500 })).mockResolvedValueOnce(new Response(null, { status: 200 }));
  vi.stubGlobal("fetch", mock);
  await expect(xAdapter.revoke({ token: "access", refreshToken: "refresh" })).rejects.toThrow("Provider authorization failed");
  expect(mock).toHaveBeenCalledTimes(2);
  expect(new URLSearchParams(mock.mock.calls[1][1].body).get("token")).toBe("refresh");
});
