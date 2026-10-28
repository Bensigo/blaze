import { chromium } from "playwright";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
try {
  process.loadEnvFile(".env.local");
} catch {
  /* Explicit environment works too. */
}
const base = process.env.TEST_BASE_URL || "http://127.0.0.1:3000";
if (!["localhost", "127.0.0.1"].includes(new URL(base).hostname))
  throw new Error(
    "This acceptance journey creates local fixture data and only runs on localhost.",
  );
if (!process.env.WORKER_TOKEN)
  throw new Error("Set WORKER_TOKEN in .env.local or the environment.");
let worker: ChildProcess | undefined;
const browser = await chromium.launch({ headless: true });
try {
  const login = await fetch(`${base}/api/auth/dev`, {
    method: "POST",
    headers: { Origin: base },
  });
  if (!login.ok)
    throw new Error(`Local login failed (${login.status}). Start npm run dev.`);
  const cookie = login.headers.get("set-cookie")!.split(";")[0];
  async function action(body: Record<string, unknown>, expected = 200) {
    const response = await fetch(`${base}/api/actions`, {
      method: "POST",
      headers: {
        Origin: base,
        Cookie: cookie,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    const result = await response.json();
    if (response.status !== expected)
      throw new Error(
        `${body.action}: ${response.status} ${result.error || ""}`,
      );
    return result;
  }
  const { game } = await action({
    action: "add_game",
    url: `${base}/fixture/index.html`,
  });
  const page = await browser.newPage();
  await page.goto(`${base}/fixture/index.html`);
  await page.locator("summary").click();
  await page.locator("#sdk-key").fill(game.sdkKey);
  await page.locator("#enable-tracking").click();
  await page.locator("#start").click();
  await page.waitForTimeout(1200);
  await page.keyboard.press("ArrowLeft");
  await page.waitForTimeout(600);
  await page.close();
  const { recording } = await action({
    action: "queue_recording",
    gameId: game.id,
    mode: "fixture",
  });
  worker = spawn(process.execPath, ["--import", "tsx", "worker/index.ts"], {
    cwd: process.cwd(),
    env: { ...process.env, APP_URL: base, ALLOW_LOCAL_FIXTURE: "true" },
    stdio: "ignore",
  });
  async function snapshot() {
    const response = await fetch(`${base}/api/workspace?gameId=${game.id}`, {
      headers: { Cookie: cookie },
    });
    if (!response.ok) throw new Error("Workspace fetch failed");
    return response.json();
  }
  async function waitFor(kind: "recordings" | "clips", id: string) {
    const deadline = Date.now() + 120000;
    while (Date.now() < deadline) {
      const data = await snapshot(),
        item = data[kind].find((r: { id: string }) => r.id === id);
      if (item?.status === "failed") throw new Error(`${kind}: ${item.error}`);
      if (item?.status === "ready") return { data, item };
      await new Promise((r) => setTimeout(r, 1000));
    }
    throw new Error(`${kind} timed out`);
  }
  const { data: recorded, item: ready } = await waitFor(
    "recordings",
    recording.id,
  );
  if (
    recorded.analytics.sessions !== 1 ||
    recorded.analytics.syntheticSessions !== 1
  )
    throw new Error("Human/agent session separation failed.");
  const { clip } = await action({
    action: "create_clip",
    recordingId: ready.id,
    title: "Fixture portrait",
    start: 0,
    end: Math.min(3, ready.duration),
    layout: "portrait",
  });
  const { item: readyClip } = await waitFor("clips", clip.id);
  for (const url of [ready.videoUrl, ready.screenshotUrl, readyClip.videoUrl]) {
    const media = await fetch(base + url, {
      headers: { Cookie: cookie, Range: "bytes=0-1023" },
    });
    if (media.status !== 206)
      throw new Error("Authenticated media range failed");
    if ((await fetch(base + url)).status !== 401)
      throw new Error("Unauthenticated media access allowed");
  }
  const { post } = await action({
    action: "create_post",
    gameId: game.id,
    clipId: clip.id,
    channel: "x",
    text: "Controlled fixture acceptance draft",
    accountId: "disconnected-fixture-account",
  });
  if (!post.trackingUrl?.includes("utm_campaign=" + post.campaignId))
    throw new Error("Post tracking link missing");
  await action({ action: "submit_review", id: post.id });
  await action({ action: "approve_post", id: post.id }, 400);
  await action({ action: "publish_post", id: post.id }, 400);
  await action({
    action: "update_post",
    id: post.id,
    gameId: game.id,
    clipId: clip.id,
    channel: "x",
    text: "Edited fixture draft",
    accountId: "disconnected-fixture-account",
    scheduledAt: new Date(Date.now() + 86400000).toISOString(),
  });
  const final = await snapshot();
  if (
    final.posts.find((p: { id: string }) => p.id === post.id)?.status !==
    "draft"
  )
    throw new Error("Editing did not reset review state");
  const report = {
    checkedAt: new Date().toISOString(),
    humanSessions: final.analytics.sessions,
    syntheticSessions: final.analytics.syntheticSessions,
    recording: "ready",
    duration: ready.duration,
    clip: "ready",
    media: "authenticated range reads; unauthenticated requests denied",
    approval:
      "disconnected approval and publication denied; editing resets review",
    providerAcceptance: "Fixture only; no social writes or live Jev calls",
  };
  await mkdir("output/playwright", { recursive: true });
  await writeFile(
    "output/playwright/journey.json",
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report));
} finally {
  worker?.kill();
  await browser.close();
}
