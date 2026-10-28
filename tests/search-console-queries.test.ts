import { afterEach, expect, it, vi } from "vitest";
import { searchConsoleQueries } from "../src/lib/integrations/search-console";
afterEach(() => vi.unstubAllGlobals());
it("returns bounded exact-page finalized observations and filters malformed and obvious sensitive rows", async () => {
  const fetch = vi.fn(async (_input: string, _init: RequestInit) => Response.json({ rows: [
    { keys: ["whot online"], clicks: 2, impressions: 20, ctr: 0.1, position: 3.5 },
    { keys: ["a@example.com"], clicks: 1, impressions: 1, ctr: 1, position: 1 },
    { keys: ["invalid"], clicks: -1, impressions: 1, ctr: 1, position: 1 },
  ] }));
  vi.stubGlobal("fetch", fetch);
  const result = await searchConsoleQueries({ token: "token", accountId: "sc-domain:example.com" }, "https://example.com/games/whot?secret=x", new Date("2026-10-28T12:00:00Z"));
  expect(result.rows).toEqual([{ query: "whot online", startDate: "2026-09-28", endDate: "2026-10-25", clicks: 2, impressions: 20, ctr: 0.1, position: 3.5 }]);
  const body = JSON.parse(String(fetch.mock.calls[0][1].body));
  expect(body).toMatchObject({ dimensions: ["query"], dataState: "final", rowLimit: 25, dimensionFilterGroups: [{ filters: [{ dimension: "page", operator: "equals", expression: "https://example.com/games/whot" }] }] });
});
it("does not query an unauthorized property", async () => {
  const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
  await expect(searchConsoleQueries({ token: "token", accountId: "sc-domain:example.com" }, "https://elsewhere.com/")).rejects.toThrow("does not cover");
  expect(fetch).not.toHaveBeenCalled();
});
