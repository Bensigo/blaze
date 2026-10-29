import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { closeDatabase, put, query } from "../src/lib/db";
import * as auth from "../src/lib/auth";
import { POST as connect } from "../src/app/api/social/[provider]/connect/route";
import { POST as refresh } from "../src/app/api/social/[provider]/refresh/route";
import { GET as callback } from "../src/app/api/social/[provider]/callback/route";
const user = { id: "user", workspace_id: "budget-workspace", email: "a@b.test", name: "A" };
const ctx = { params: Promise.resolve({ provider: "x_feedback" }) };
const origin = "http://localhost:3000";
const post = (path: string, body: unknown) => new Request(`${origin}${path}`, { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify(body) });
beforeAll(() => { vi.stubEnv("LOCAL_DATABASE_PATH", "memory://"); vi.stubEnv("DATABASE_URL", ""); vi.stubEnv("VERCEL", ""); vi.stubEnv("APP_URL", origin); });
beforeEach(async () => { await query("DELETE FROM records"); vi.spyOn(auth, "requireIdentity").mockResolvedValue(user); });
afterAll(async () => { await closeDatabase(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
it("blocks connection and an in-flight callback even with consent and configured credentials", async () => {
  vi.stubEnv("X_FEEDBACK_CLIENT_ID", "fake"); vi.stubEnv("X_FEEDBACK_CLIENT_SECRET", "fake");
  const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
  const res = await connect(post("/api/social/x_feedback/connect", { readOnlyConsent: true }), ctx);
  expect(res.status).toBe(403); expect((await res.json()).error).toContain("total spending cap");
  const result = await callback(new Request(`${origin}/api/social/x_feedback/callback?code=test&state=test`), ctx);
  expect(result.status).toBe(303); expect(new URL(result.headers.get("location")!).searchParams.get("social")).toBe("failed");
  expect(fetch).not.toHaveBeenCalled();
});
it("blocks refreshing an existing feedback identity without contacting X", async () => {
  const id = `conn_${"a".repeat(32)}`;
  await put(user.workspace_id, "connection", { id, provider: "x_feedback", connected: true, label: "X" });
  const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
  const res = await refresh(post("/api/social/x_feedback/refresh", { connectionId: id }), ctx);
  expect(res.status).toBe(403); expect(fetch).not.toHaveBeenCalled();
});
