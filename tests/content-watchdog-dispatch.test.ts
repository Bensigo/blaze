import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dispatchContentWatchdog } from "../src/lib/content-watchdog-dispatch";
// @ts-expect-error Explicit .mts import is compiled by Vitest and Netlify.
import scheduled, { config } from "../netlify/functions/blaze-content-watchdog.mts";
beforeEach(() => {
  vi.stubEnv("BLAZE_CLOUD_WATCHDOG_SCHEDULE_ENABLED", "false"); vi.stubEnv("BLAZE_CLOUD_WATCHDOG_ENABLED", "true");
  vi.stubEnv("BLAZE_CLOUD_WATCHDOG_WORKSPACE_ID", "owner-workspace"); vi.stubEnv("CRON_SECRET", "fixture-cron");
  vi.stubEnv("CONTEXT", "production"); vi.stubEnv("URL", "https://blaze-bensigo.netlify.app");
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 200 })));
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
describe("independent native watchdog dispatch", () => {
  it("is inert by default and uses the approved minute cadence", async () => {
    expect(config.schedule).toBe("* * * * *"); expect((await scheduled()).status).toBe(204); expect(fetch).not.toHaveBeenCalled();
  });
  it("sends only the pinned workspace to the fixed production route with server bearer", async () => {
    vi.stubEnv("BLAZE_CLOUD_WATCHDOG_SCHEDULE_ENABLED", "true");
    vi.stubEnv("DEPLOY_PRIME_URL", "https://untrusted-preview.example");
    expect(await dispatchContentWatchdog()).toEqual({ paused: false });
    expect(fetch).toHaveBeenCalledOnce();
    const [url, options] = vi.mocked(fetch).mock.calls[0];
    expect(String(url)).toBe("https://blaze-bensigo.netlify.app/api/cron/content-production-watchdog");
    expect(options).toMatchObject({ method: "POST", redirect: "error", body: JSON.stringify({ workspaceId: "owner-workspace" }), headers: { Authorization: "Bearer fixture-cron" } });
  });
  it("rejects preview runs, missing configuration and bearer-redirection destinations before sending", async () => {
    vi.stubEnv("BLAZE_CLOUD_WATCHDOG_SCHEDULE_ENABLED", "true");
    for (const [key, bad] of [["CONTEXT", "deploy-preview"], ["CRON_SECRET", ""], ["BLAZE_CLOUD_WATCHDOG_WORKSPACE_ID", "bad\nworkspace"], ["BLAZE_CLOUD_WATCHDOG_ENABLED", "false"], ["URL", "https://elsewhere.example"], ["URL", "https://blaze-bensigo.netlify.app/?next=elsewhere"]]) {
      const prior = process.env[key]; vi.stubEnv(key, bad); await expect(dispatchContentWatchdog()).rejects.toThrow(); vi.stubEnv(key, prior);
    }
    expect(fetch).not.toHaveBeenCalled();
  });
  it("does not retry failed or uncertain delivery", async () => {
    vi.stubEnv("BLAZE_CLOUD_WATCHDOG_SCHEDULE_ENABLED", "true");
    vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 503 }));
    await expect(dispatchContentWatchdog()).rejects.toThrow("Watchdog dispatch failed"); expect(fetch).toHaveBeenCalledOnce();
    vi.mocked(fetch).mockClear().mockRejectedValueOnce(new Error("timeout"));
    await expect(dispatchContentWatchdog()).rejects.toThrow("timeout"); expect(fetch).toHaveBeenCalledOnce();
  });
});
