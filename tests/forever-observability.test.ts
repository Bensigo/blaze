import { describe, expect, it, vi } from "vitest";
import { readForeverObservability, type ForeverReport } from "../src/lib/forever-observability";

export function fixtureReport(): ForeverReport {
  const now = new Date().toISOString();
  return {
    schemaVersion: 1, generatedAt: now, window: { days: 14, since: new Date(Date.now() - 14 * 86400000).toISOString(), until: now },
    summary: { sessions: 3, gameViewSessions: 2, playClickSessions: 1, readySessions: 1, startedSessions: 1, actionSessions: 1, noPlaySessions: 2, errorSessions: 1 },
    funnel: [{ stage: "visit", sessions: 3 }, { stage: "game_view", sessions: 2 }, { stage: "play_click", sessions: 1 }, { stage: "game_ready", sessions: 1 }, { stage: "round_start", sessions: 1 }, { stage: "first_action", sessions: 1 }],
    games: [{ game: "last-card", views: 2, playClicks: 1, ready: 1, starts: 1, actions: 1, actionCoverage: "live", completed: 0, errorSessions: 1 }],
    errors: [{ code: "load_timeout", game: "last-card", browser: "safari", device: "iphone", count: 1, sessions: 1, lastAt: now, source: "browser" }],
    delivery: { pending: 0, dropped: 0, writeFailures: 0 },
    recent: [{ session: "a".repeat(64), game: "last-card", device: "iphone", browser: "safari", at: now, stage: "error", code: "load_timeout" }],
    limitations: ["Controlled test data. Counts are browser observations, not people."],
  };
}
const token = "private-operator-token-32-characters-long";
const env: NodeJS.ProcessEnv = { NODE_ENV: "production", FOREVER_OBSERVABILITY_WORKSPACE_ID: "owner", FOREVER_OBSERVABILITY_TOKEN: token };
describe("private Forever diagnostics bridge", () => {
  it("never requests or exposes another workspace's report, even with a valid server token", async () => {
    const fetcher = vi.fn();
    expect(await readForeverObservability("other", { env, fetcher })).toMatchObject({ status: "not_configured" });
    expect(await readForeverObservability("owner", { env: { ...env, FOREVER_OBSERVABILITY_TOKEN: "short" }, fetcher })).toMatchObject({ status: "not_configured" });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("reads only the fixed production endpoint, strips extra fields and keeps the bearer server-side", async () => {
    const fetcher = vi.fn(async () => Response.json({ ...fixtureReport(), token, privateAccount: "must-not-escape" }));
    const result = await readForeverObservability("owner", { env: { ...env, FOREVER_OBSERVABILITY_LOCAL_ORIGIN: "https://attacker.test" }, fetcher });
    expect(result.status).toBe("connected");
    expect(fetcher).toHaveBeenCalledWith("https://playforever.app/api/internal/site-diagnostics", expect.objectContaining({ redirect: "error", cache: "no-store", headers: expect.objectContaining({ Authorization: `Bearer ${token}` }) }));
    expect(JSON.stringify(result)).not.toContain(token);
    expect(JSON.stringify(result)).not.toContain("must-not-escape");
    expect(result.status === "connected" && result.report.summary.noPlaySessions).toBe(2);
  });
  it("preserves unavailable and rejected connections instead of reporting zero visitors", async () => {
    for (const status of [401, 404, 500]) {
      const result = await readForeverObservability("owner", { env, fetcher: vi.fn(async () => Response.json({ error: token }, { status })) });
      expect(result.status).toBe("unavailable"); expect(JSON.stringify(result)).not.toContain(token); expect(result).not.toHaveProperty("report");
    }
  });
  it("rejects stale, malformed, excessive and unreachable reports without returning upstream text", async () => {
    const invalid = [
      { ...fixtureReport(), generatedAt: "2020-01-01T00:00:00.000Z" },
      { ...fixtureReport(), summary: { ...fixtureReport().summary, sessions: -1 } },
      { ...fixtureReport(), recent: Array.from({ length: 101 }, () => fixtureReport().recent[0]) },
    ];
    for (const value of invalid) expect((await readForeverObservability("owner", { env, fetcher: vi.fn(async () => Response.json(value)) })).status).toBe("unavailable");
    expect((await readForeverObservability("owner", { env, fetcher: vi.fn(async () => new Response("x".repeat(262145))) })).status).toBe("unavailable");
    expect((await readForeverObservability("owner", { env, fetcher: vi.fn(async () => { throw Error(token); }) })).status).toBe("unavailable");
  });
  it("permits only an explicit loopback HTTP override for local integration testing", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json(fixtureReport()));
    expect((await readForeverObservability("owner", { env: { ...env, NODE_ENV: "development", FOREVER_OBSERVABILITY_LOCAL_ORIGIN: "http://127.0.0.1:4173" }, fetcher })).status).toBe("connected");
    expect(fetcher.mock.calls[0][0]).toBe("http://127.0.0.1:4173/api/internal/site-diagnostics");
    fetcher.mockClear();
    expect((await readForeverObservability("owner", { env: { ...env, NODE_ENV: "development", FOREVER_OBSERVABILITY_LOCAL_ORIGIN: "http://127.0.0.1:4173@evil.test" }, fetcher })).status).toBe("unavailable");
    expect(fetcher).not.toHaveBeenCalled();
  });
});
