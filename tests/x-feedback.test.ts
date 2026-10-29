import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { closeDatabase, get, list, put, query } from "../src/lib/db";
import { encrypt } from "../src/lib/security";
import { collectFeedback, readFeedback } from "../src/lib/x-feedback";
import { xFeedbackAdapter } from "../src/lib/social-x-youtube";
import type { Connection, Game, Finding } from "../src/lib/types";
import * as auth from "../src/lib/auth";
import { GET, POST } from "../src/app/api/games/[id]/feedback/route";
const game: Game = { id: "game1", title: "My Game", url: "https://game.example/", description: "", image: "", genre: "", sdkKey: "", origins: [], createdAt: "", dailyEnabled: false, competitors: [] };
const user = { id: "user1", workspace_id: "w1", email: "a@b.test", name: "A" };
const ctx = { params: Promise.resolve({ id: "game1" }) };
const connection: Connection = { id: "conn_test", provider: "x_feedback", label: "X", connected: true, authMethod: "oauth", scopes: ["tweet.read", "users.read", "offline.access"], expiresAt: new Date(Date.now() + 3600000).toISOString() };
const req = (body: unknown, origin = "http://localhost:3000") => new Request("http://localhost:3000/api/games/game1/feedback", { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify(body) });
beforeAll(() => { vi.stubEnv("LOCAL_DATABASE_PATH", "memory://"); vi.stubEnv("DATABASE_URL", ""); vi.stubEnv("VERCEL", ""); vi.stubEnv("APP_URL", "http://localhost:3000"); vi.stubEnv("CREDENTIAL_KEY", Buffer.alloc(32, 7).toString("base64")); });
beforeEach(async () => { await query("DELETE FROM records"); await query("DELETE FROM credentials"); await put("w1", "game", game); vi.spyOn(auth, "requireIdentity").mockResolvedValue(user); });
afterAll(async () => { await closeDatabase(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
async function connect(c = connection) { await put("w1", "connection", c); await query("INSERT INTO credentials(workspace_id,provider,encrypted) VALUES($1,$2,$3)", ["w1", c.id, await encrypt({ token: "secret-token", scopes: connection.scopes })]); }
it("discloses only separate feedback scopes and client credentials", () => {
  vi.stubEnv("X_FEEDBACK_CLIENT_ID", "feedback-id"); vi.stubEnv("X_FEEDBACK_CLIENT_SECRET", "feedback-secret");
  const url = new URL(xFeedbackAdapter.authorizationUrl({ state: "s", challenge: "c", redirectUri: "https://app.test/callback" }));
  expect(url.searchParams.get("client_id")).toBe("feedback-id");
  expect(url.searchParams.get("scope")).toBe("tweet.read users.read offline.access");
  expect(url.searchParams.get("scope")).not.toMatch(/write/);
});
it("requires own game, same origin and per-run consent before any call", async () => {
  const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
  expect((await POST(req({}), ctx)).status).toBe(400);
  expect((await POST(req({ confirmSearchAndCost: true }, "https://evil.test"), ctx)).status).toBe(403);
  expect((await GET(new Request("http://localhost:3000"), { params: Promise.resolve({ id: "other" }) })).status).toBe(404);
  expect(fetch).not.toHaveBeenCalled();
});
it("never uses a publishing credential and treats identity and entitlement separately", async () => {
  await connect({ ...connection, provider: "x" });
  expect((await readFeedback("w1", game)).identity).toBe("disconnected");
  await expect(collectFeedback("w1", game)).rejects.toThrow("separate read-only");
});
it("bounds one request, groups evidence, and preserves owner status on repeat", async () => {
  await connect();
  const fetch = vi.fn().mockImplementation(async () => Response.json({ data: [
    { id: "123", text: "My Game crash", created_at: "2026-10-28T10:00:00Z" },
    { id: "124", text: "Please add levels to My Game", created_at: "2026-10-28T11:00:00Z" },
    { id: "125", text: "Playing https://game.example/", created_at: "2026-10-28T12:00:00Z" },
  ] })); vi.stubGlobal("fetch", fetch);
  const result = await collectFeedback("w1", game);
  expect(fetch).toHaveBeenCalledTimes(1); expect(new URL(fetch.mock.calls[0][0]).searchParams.get("max_results")).toBe("10");
  expect(result.groups.reportedBugs[0]).toMatchObject({ feedback: { relevance: "possible", verification: "reported_not_reproduced" } });
  expect(result.groups.featureRequests).toHaveLength(1); expect(result.groups.mentions[0].feedback.relevance).toBe("direct");
  const bug = result.groups.reportedBugs[0]; await put("w1", "finding", { ...bug, status: "resolved", resolvedAt: "2026-10-29T00:00:00Z" });
  expect((await collectFeedback("w1", game)).saved).toBe(0);
  expect(await get<Finding>("w1", "finding", bug.id)).toMatchObject({ status: "resolved", resolvedAt: "2026-10-29T00:00:00Z" });
  expect(await list("w2", "finding")).toEqual([]);
});
it("sanitizes search failure and does not claim entitlement", async () => {
  await connect(); vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("secret-token", { status: 403 })));
  await expect(collectFeedback("w1", game)).rejects.toThrow("HTTP 403");
  expect((await readFeedback("w1", game)).entitlement).toBe("not_tested");
});
it("refuses feedback configured with the publishing app client id", () => {
  vi.stubEnv("X_CLIENT_ID", "same-app"); vi.stubEnv("X_FEEDBACK_CLIENT_ID", "same-app"); vi.stubEnv("X_FEEDBACK_CLIENT_SECRET", "feedback-secret");
  expect(xFeedbackAdapter.configured()).toBe(false);
});
it("rejects unexpected write scopes before looking up identity", async () => {
  vi.stubEnv("X_CLIENT_ID", "publishing-app"); vi.stubEnv("X_FEEDBACK_CLIENT_ID", "feedback-app"); vi.stubEnv("X_FEEDBACK_CLIENT_SECRET", "feedback-secret");
  const fetch = vi.fn().mockResolvedValue(Response.json({ access_token: "token", refresh_token: "refresh", expires_in: 7200, scope: "tweet.read users.read offline.access tweet.write" }));
  vi.stubGlobal("fetch", fetch);
  await expect(xFeedbackAdapter.exchange({ code: "code", verifier: "verifier", redirectUri: "https://app.test/callback" })).rejects.toThrow("unexpected permissions");
  expect(fetch).toHaveBeenCalledTimes(1);
});
it("blocks an explicitly confirmed search before any paid request by default", async () => {
  await connect(); const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
  const response = await POST(req({ confirmSearchAndCost: true }), ctx);
  expect(response.status).toBe(403);
  expect((await response.json()).error).toContain("total spending cap");
  expect(fetch).not.toHaveBeenCalled();
  expect(await readFeedback("w1", game)).toMatchObject({ blocked: true, spendCap: "not_enforced", entitlement: "not_tested" });
});
