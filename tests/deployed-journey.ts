// Opt-in live acceptance for this NEW project's isolated release workspace only.
import { chromium } from "playwright";
import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { writeFile, mkdir } from "node:fs/promises";
import { del } from "@vercel/blob";
if (process.env.ALLOW_LIVE_ACCEPTANCE !== "true")
  throw new Error(
    "Set ALLOW_LIVE_ACCEPTANCE=true for the isolated release test.",
  );
const base = process.env.RELEASE_BASE_URL;
if (!base || !new URL(base).hostname.startsWith("web-game-marketing"))
  throw new Error("Use the verified new product deployment.");
process.loadEnvFile(".env.vercel.local");
process.loadEnvFile(".env.release.local");
const db = await import("../src/lib/db");
const workspace = `release_acceptance_${randomUUID()}`,
  gameId = db.id("game"),
  recordingId = db.id("rec");
const workerHeaders = { Authorization: `Bearer ${process.env.WORKER_TOKEN}` };
let worker: ChildProcess | undefined;
const browser = await chromium.launch({ headless: true });
try {
  const health = await fetch(base + "/api/health");
  if (!health.ok) throw new Error("Production database health failed.");
  if ((await fetch(base + "/api/workspace")).status !== 401)
    throw new Error("Private workspace is not protected.");
  if (
    (
      await fetch(base + "/api/auth/dev", {
        method: "POST",
        headers: { Origin: base },
      })
    ).status !== 404
  )
    throw new Error("Development login is exposed in production.");
  await db.put(workspace, "game", {
    id: gameId,
    title: "Star Catch release acceptance",
    url: base + "/fixture/index.html",
    description: "Isolated fixture acceptance; not owner analytics.",
    image: base + "/fixture/cover.svg",
    genre: "Fixture",
    sdkKey: db.id("sdk"),
    origins: [base],
    createdAt: new Date().toISOString(),
    dailyEnabled: false,
    competitors: [],
  });
  const game = await db.get<{ sdkKey: string }>(workspace, "game", gameId);
  if (!game) throw new Error("Fixture game missing");
  const page = await browser.newPage();
  await page.goto(base + "/fixture/index.html");
  await page.locator("summary").click();
  await page.locator("#sdk-key").fill(game.sdkKey);
  await page.locator("#enable-tracking").click();
  await page.locator("#start").click();
  await page.waitForTimeout(1200);
  await page.close();
  await db.put(workspace, "recording", {
    id: recordingId,
    gameId,
    title: "Production fixture acceptance",
    status: "queued",
    mode: "fixture",
    createdAt: new Date().toISOString(),
  });
  await db.query(
    `INSERT INTO jobs(id,workspace_id,kind,state,body) VALUES($1,$2,'recording','queued',$3::jsonb)`,
    [recordingId, workspace, JSON.stringify({ id: recordingId })],
  );
  worker = spawn(process.execPath, ["--import", "tsx", "worker/index.ts"], {
    cwd: process.cwd(),
    env: { ...process.env, APP_URL: base, BLOB_CLIENT_UPLOAD: "true" },
    stdio: "ignore",
  });
  async function ready(kind: string, id: string) {
    const deadline = Date.now() + 120000;
    while (Date.now() < deadline) {
      const row = await db.get<{
        id: string;
        status: string;
        error?: string;
        duration: number;
        videoUrl: string;
        screenshotUrl: string;
      }>(workspace, kind, id);
      if (row?.status === "failed")
        throw new Error(`${kind} failed: ${row.error}`);
      if (row?.status === "ready") return row;
      await new Promise((r) => setTimeout(r, 1500));
    }
    throw new Error(kind + " timed out");
  }
  const rec = await ready("recording", recordingId),
    clipId = db.id("clip");
  await db.put(workspace, "clip", {
    id: clipId,
    gameId,
    recordingId,
    title: "Production portrait acceptance",
    start: 0,
    end: Math.min(rec.duration, 3),
    layout: "portrait",
    status: "queued",
    createdAt: new Date().toISOString(),
  });
  await db.query(
    `INSERT INTO jobs(id,workspace_id,kind,state,body) VALUES($1,$2,'clip','queued',$3::jsonb)`,
    [clipId, workspace, JSON.stringify({ id: clipId })],
  );
  const clip = await ready("clip", clipId);
  const counts = await db.query<{ kind: string; sessions: string }>(
    `SELECT kind,count(DISTINCT session_id)::text AS sessions FROM events WHERE workspace_id=$1 GROUP BY kind`,
    [workspace],
  );
  if (
    counts.find((c) => c.kind === "human")?.sessions !== "1" ||
    counts.find((c) => c.kind === "agent")?.sessions !== "1"
  )
    throw new Error("Production human/synthetic separation failed.");
  const output =
    "/Users/macbook/Documents/Codex/2026-10-28/web-game-marketing-build/outputs";
  await mkdir(output, { recursive: true });
  for (const [name, url] of [
    ["fixture-gameplay.webm", rec.videoUrl],
    ["fixture-screenshot.png", rec.screenshotUrl],
    ["fixture-portrait.mp4", clip.videoUrl],
  ]) {
    const response = await fetch(base + url, { headers: workerHeaders });
    if (!response.ok) throw new Error("Private deployed asset failed");
    await writeFile(
      output + "/" + name,
      Buffer.from(await response.arrayBuffer()),
    );
    const range = await fetch(base + url, {
      headers: { ...workerHeaders, Range: "bytes=0-1023" },
    });
    if (range.status !== 206)
      throw new Error("Private deployed media range failed");
    if ((await fetch(base + url)).status !== 401)
      throw new Error("Private deployed media exposed");
  }
  const report = {
    checkedAt: new Date().toISOString(),
    url: base,
    database: "persistent PostgreSQL verified",
    fixtureRecording: "ready; actual deployed video and screenshot",
    portraitClip: "ready; private Blob direct upload",
    sessions: counts,
    auth: "workspace 401; production dev login 404; private assets 401",
    model: "fixture decisions only; live Jev awaits key",
    socialPostsPublished: 0,
  };
  await writeFile(
    output + "/production-journey.json",
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report));
} finally {
  worker?.kill();
  await browser.close();
  const assets = await db.list<{
    id: string;
    location: string;
    backend: string;
  }>(workspace, "media");
  for (const a of assets) if (a.backend === "blob") await del(a.location);
  for (const table of [
    "events",
    "jobs",
    "records",
    "credentials",
    "daily_runs",
    "publish_dispatches",
  ])
    await db.query(`DELETE FROM ${table} WHERE workspace_id=$1`, [workspace]);
  console.log("Removed isolated release records and their test Blobs.");
}
