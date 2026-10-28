import { afterEach, describe, expect, it, vi } from "vitest";
import {
  searchConsoleComparison,
  searchConsoleWindows,
  verifySearchConsole,
} from "../src/lib/integrations";
const secret = { token: "test-token", accountId: "sc-domain:example.com" };
afterEach(() => vi.unstubAllGlobals());
describe("Search Console", () => {
  it("checks the selected authorized property instead of claiming success for any property", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          siteEntry: [
            {
              siteUrl: "sc-domain:example.com",
              permissionLevel: "siteFullUser",
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          siteEntry: [
            {
              siteUrl: "sc-domain:elsewhere.com",
              permissionLevel: "siteOwner",
            },
          ],
        }),
      );
    vi.stubGlobal("fetch", fetch);
    expect(await verifySearchConsole(secret)).toMatchObject({
      connected: true,
      accountId: secret.accountId,
    });
    expect((await verifySearchConsole(secret)).connected).toBe(false);
    expect(fetch.mock.calls[0][0]).toBe(
      "https://www.googleapis.com/webmasters/v3/sites",
    );
  });
  it("queries two inclusive 28-day final-data windows and keeps the exact game page filter", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          rows: [{ clicks: 8, impressions: 100, ctr: 0.08, position: 4.2 }],
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          rows: [{ clicks: 5, impressions: 90, ctr: 5 / 90, position: 5 }],
        }),
      );
    vi.stubGlobal("fetch", fetch);
    const now = new Date("2026-10-28T12:00:00Z");
    expect(searchConsoleWindows(now)).toEqual({
      recent: { startDate: "2026-09-28", endDate: "2026-10-25" },
      prior: { startDate: "2026-08-31", endDate: "2026-09-27" },
    });
    const result = await searchConsoleComparison(
      secret,
      "https://game.example.com/play?token=private",
      now,
    );
    expect(result.recent).toMatchObject({
      clicks: 8,
      impressions: 100,
      ctr: 0.08,
      position: 4.2,
    });
    expect(result.prior?.clicks).toBe(5);
    expect(fetch).toHaveBeenCalledTimes(2);
    for (const call of fetch.mock.calls) {
      expect(call[0]).toContain(encodeURIComponent(secret.accountId));
      const body = JSON.parse(String(call[1].body));
      expect(body.dataState).toBe("final");
      expect(body.dimensionFilterGroups[0].filters[0].expression).toBe(
        "https://game.example.com/play",
      );
    }
  });
  it("does not fabricate zero results for empty or failed periods", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(Response.json({}))
        .mockResolvedValueOnce(new Response("", { status: 403 })),
    );
    const result = await searchConsoleComparison(
      secret,
      "https://example.com/",
    );
    expect(result.recent).toBeNull();
    expect(result.prior).toBeNull();
    expect(result.failures).toEqual(["prior"]);
  });
  it("rejects an unrelated property before a request", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    await expect(
      searchConsoleComparison(secret, "https://notexample.com/"),
    ).rejects.toThrow("does not cover");
    expect(fetch).not.toHaveBeenCalled();
  });
});
