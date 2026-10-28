import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { instagramAdapter, tiktokAdapter } from "../src/lib/social-instagram-tiktok";

const igScopes = "instagram_business_basic,instagram_business_content_publish";
const ttScopes = "user.info.basic,video.publish";
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
const input = { code: "code", verifier: "verifier", redirectUri: "https://app.test/callback" };
const igShort = { data: [{ access_token: "short", user_id: "123", permissions: igScopes }] };
const igLong = { access_token: "long", expires_in: 5184000 };
const igProfile = { user_id: "123", username: "creator" };
const ttToken = { access_token: "access", refresh_token: "refresh", open_id: "abc", scope: ttScopes, expires_in: 86400 };
const ttProfile = { data: { user: { open_id: "abc", display_name: "Creator" } }, error: { code: "ok" } };
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.stubEnv("INSTAGRAM_CLIENT_ID", "ig-id"); vi.stubEnv("INSTAGRAM_CLIENT_SECRET", "ig-secret");
  vi.stubEnv("TIKTOK_CLIENT_KEY", "tt-key"); vi.stubEnv("TIKTOK_CLIENT_SECRET", "tt-secret");
  fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("Instagram professional login", () => {
  it("uses professional scopes and verifies actual permissions, token and account", async () => {
    const url = new URL(instagramAdapter.authorizationUrl({ state: "s", challenge: "challenge", redirectUri: input.redirectUri }));
    expect(url.hostname).toBe("www.instagram.com"); expect(url.searchParams.get("scope")).toBe(igScopes);
    expect(url.searchParams.has("code_challenge")).toBe(false);
    fetchMock.mockResolvedValueOnce(json(igShort)).mockResolvedValueOnce(json(igLong)).mockResolvedValueOnce(json(igProfile));
    const grant = await instagramAdapter.exchange(input);
    expect(grant).toMatchObject({ accountId: "123", accountName: "creator", scopes: igScopes.split(","), secret: { token: "long", accountId: "123" } });
    expect(new URL(fetchMock.mock.calls[1][0]).host).toBe("graph.instagram.com");
  });
  it("fails closed on missing permissions and mismatched identity", async () => {
    fetchMock.mockResolvedValueOnce(json({ ...igShort, data: [{ ...igShort.data[0], permissions: "instagram_business_basic" }] }));
    await expect(instagramAdapter.exchange(input)).rejects.toThrow(/permissions/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fetchMock.mockResolvedValueOnce(json(igShort)).mockResolvedValueOnce(json(igLong)).mockResolvedValueOnce(json({ ...igProfile, user_id: "999" }));
    await expect(instagramAdapter.exchange(input)).rejects.toThrow();
  });
  it("refreshes and retains verified permissions; rejects missing evidence", async () => {
    fetchMock.mockResolvedValueOnce(json({ access_token: "new", expires_in: 5000 })).mockResolvedValueOnce(json(igProfile));
    const grant = await instagramAdapter.refresh({ token: "old", accountId: "123", scopes: igScopes.split(",") });
    expect(grant.secret.token).toBe("new"); expect(grant.scopes).toEqual(igScopes.split(","));
    await expect(instagramAdapter.refresh({ token: "old", accountId: "123" })).rejects.toThrow(/permissions/);
    await expect(instagramAdapter.revoke({ token: "old" })).rejects.toThrow(/Instagram.*connected apps/);
  });
});

describe("TikTok web login", () => {
  it("exchanges without PKCE and verifies scopes and identity", async () => {
    const url = new URL(tiktokAdapter.authorizationUrl({ state: "s", challenge: "challenge", redirectUri: input.redirectUri }));
    expect(url.searchParams.get("scope")).toBe(ttScopes); expect(url.searchParams.has("code_challenge")).toBe(false);
    fetchMock.mockResolvedValueOnce(json(ttToken)).mockResolvedValueOnce(json(ttProfile));
    const grant = await tiktokAdapter.exchange(input);
    expect(grant).toMatchObject({ accountId: "abc", accountName: "Creator", secret: { token: "access", refreshToken: "refresh" } });
    const body = new URLSearchParams(fetchMock.mock.calls[0][1].body);
    expect(body.has("code_verifier")).toBe(false); expect(body.get("redirect_uri")).toBe(input.redirectUri);
  });
  it("rejects missing permission, absent profile, or a changed account", async () => {
    fetchMock.mockResolvedValueOnce(json({ ...ttToken, scope: "user.info.basic" }));
    await expect(tiktokAdapter.exchange(input)).rejects.toThrow(/permissions/);
    fetchMock.mockResolvedValueOnce(json(ttToken)).mockResolvedValueOnce(json({ ...ttProfile, data: { user: { open_id: "different", display_name: "Creator" } } }));
    await expect(tiktokAdapter.exchange(input)).rejects.toThrow();
    fetchMock.mockResolvedValueOnce(json({ ...ttToken, open_id: "different" }));
    await expect(tiktokAdapter.refresh({ token: "old", refreshToken: "refresh", accountId: "abc" })).rejects.toThrow();
  });
  it("rotates refresh tokens and keeps the old one if omitted", async () => {
    const secret = { token: "old", refreshToken: "old-refresh", accountId: "abc" };
    fetchMock.mockResolvedValueOnce(json({ ...ttToken, refresh_token: "rotated" })).mockResolvedValueOnce(json(ttProfile));
    expect((await tiktokAdapter.refresh(secret)).secret.refreshToken).toBe("rotated");
    fetchMock.mockResolvedValueOnce(json({ ...ttToken, refresh_token: undefined })).mockResolvedValueOnce(json(ttProfile));
    expect((await tiktokAdapter.refresh(secret)).secret.refreshToken).toBe("old-refresh");
  });
  it("revokes with access token and sanitizes provider errors", async () => {
    fetchMock.mockResolvedValueOnce(json({}));
    await tiktokAdapter.revoke({ token: "access" });
    expect(new URLSearchParams(fetchMock.mock.calls[0][1].body).get("token")).toBe("access");
    fetchMock.mockResolvedValueOnce(json({ error: "bad", error_description: "secret-value" }));
    await expect(tiktokAdapter.revoke({ token: "access" })).rejects.toThrow("Provider authorization failed");
    fetchMock.mockRejectedValueOnce(new Error("token=secret-value"));
    await expect(tiktokAdapter.exchange(input)).rejects.toThrow("Provider authorization failed");
  });
});
