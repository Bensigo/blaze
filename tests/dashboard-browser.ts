/** Run against the local app: npx tsx tests/dashboard-browser.ts. All API responses below are mocked. */
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { buildDemo } from "../src/lib/demo";

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
let mode: "signed_out" | "empty" | "populated" = "signed_out";
let denyNextPage = false;
let holdNextPage = false;
let releaseNextPage: (() => void) | undefined;
let pendingNextPage: (() => void) | undefined;
let demoRequests = 0;
const demo = buildDemo();
const game = { ...demo.games[0], id: "test-game", title: "Test game", url: "https://game.example", image: "https://game.example/cover.png" };
const second = { ...game, id: "test-game-two", title: "Second game" };
const template = demo.analytics.sessionsList[0];
const rows = Array.from({ length: 100 }, (_, i) => ({ ...template, id: `first-${i}`, gameId: game.id }));
const pageTwo = [{ ...template, id: "next-page-record", gameId: game.id }];
const workspace = (empty = false, selected = "all") => ({
  ...demo,
  demo: false,
  user: { name: "Test owner", email: "test@example.test" },
  games: empty ? [] : [game, second],
  recordings: [], clips: [], posts: [], findings: [], measurements: [],
  analytics: {
    ...demo.analytics,
    sessions: empty ? 0 : 101,
    players: empty ? 0 : 101,
    sessionsList: empty ? [] : selected === second.id ? [{ ...template, id: "new-scope-record", gameId: second.id }] : rows,
    sessionPage: { limit: 100, total: empty ? 0 : selected === second.id ? 1 : 101, ...(empty || selected === second.id ? {} : { nextCursor: "cursor-2" }) },
    coverage: { countries: { shown: 2, total: 3 }, heatmap: { shown: 4, total: 4 } },
  },
});
const json = (route: import("playwright").Route, body: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
await page.route("**/api/**", async (route) => {
  const url = new URL(route.request().url());
  if (url.pathname === "/api/auth/config") return json(route, { googleConfigured: true });
  if (url.pathname === "/api/workspace") return mode === "signed_out" ? json(route, { error: "Unauthorized" }, 401) : json(route, workspace(mode === "empty", url.searchParams.get("gameId") || "all"));
  if (url.pathname === "/api/demo") { demoRequests++; return json(route, demo); }
  if (url.pathname.startsWith("/api/sessions/")) return json(route, {
    session: rows[0], events: [{ id: "event-1", name: "visit", timestamp: new Date().toISOString(), properties: {} }], eventsTruncated: true,
  });
  if (url.pathname === "/api/sessions") {
    if (denyNextPage) return json(route, { error: "Unauthorized" }, 401);
    if (holdNextPage) {
      pendingNextPage?.();
      await new Promise<void>((resolve) => { releaseNextPage = resolve; });
    }
    return json(route, { sessions: pageTwo, total: 101, limit: 100 });
  }
  return route.continue();
});
const openSessions = async () => page.getByRole("navigation").getByRole("button", { name: "Sessions", exact: true }).click();
try {
  await page.goto(new URL("/app", process.env.BASE_URL || "http://127.0.0.1:3000").toString());
  await page.getByRole("link", { name: "Continue with Google" }).waitFor();
  assert.equal(demoRequests, 0, "401 must not fetch example data");
  await page.getByRole("button", { name: "Explore an example workspace" }).click();
  await page.getByText("Illustrative data, not your games or analytics.").waitFor();
  assert.equal(demoRequests, 1);

  mode = "empty";
  await page.reload();
  await page.getByRole("navigation").getByRole("button", { name: "Games", exact: true }).click();
  await page.getByText("No games added").waitFor();
  assert.equal(await page.getByText("Illustrative data, not your games or analytics.").count(), 0);

  mode = "populated";
  await page.reload();
  await page.getByRole("navigation").getByRole("button", { name: "Player analytics", exact: true }).click();
  await page.getByText(/Limited breakdowns: 2 of 3 countries/).waitFor();
  await openSessions();
  await page.getByText("Showing 1–100 of 101 sessions").waitFor();
  await page.getByRole("row").filter({ hasText: "first-0" }).click();
  await page.getByText(/This timeline was limited to 5,000 events/).waitFor();
  await page.getByLabel("Filter by game").selectOption(second.id);
  await page.getByRole("button", { name: "Close session" }).waitFor();
  await page.getByRole("button", { name: "Close session" }).click();
  await page.getByText("Showing 1–1 of 1 sessions").waitFor();
  await page.getByLabel("Filter by game").selectOption("all");
  await page.getByText("Showing 1–100 of 101 sessions").waitFor();
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await page.getByText("Showing 101–101 of 101 sessions").waitFor();
  await page.getByRole("button", { name: "Previous", exact: true }).click();
  await page.getByText("Showing 1–100 of 101 sessions").waitFor();
  const pending = new Promise<void>((resolve) => { pendingNextPage = resolve; });
  holdNextPage = true;
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await pending;
  await page.getByLabel("Filter by game").selectOption(second.id);
  await page.getByText("Showing 1–1 of 1 sessions").waitFor();
  releaseNextPage?.();
  await page.waitForTimeout(150);
  assert.equal(await page.getByText("Showing 101–101 of 101 sessions").count(), 0, "old page must not replace new filter scope");
  holdNextPage = false;
  await page.getByLabel("Filter by game").selectOption("all");
  await page.getByText("Showing 1–100 of 101 sessions").waitFor();
  denyNextPage = true;
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await page.getByRole("link", { name: "Continue with Google" }).waitFor();
  assert.equal(demoRequests, 1, "expired authentication must not open demo");
  console.log("PASS mocked dashboard auth, example, empty workspace, pagination, filter race, coverage, timeline truncation, preserved inspector, and expired session");
} finally {
  releaseNextPage?.();
  await browser.close();
}
