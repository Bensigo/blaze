import { chromium, type BrowserContext } from "playwright";
import { upload as uploadBlob } from "@vercel/blob/client";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { validateGameUrl } from "./safety";
import { RunEvidence, failureCode, safePhase } from "./observations";

const app = new URL(process.env.APP_URL || "http://127.0.0.1:3000");
const token = process.env.WORKER_TOKEN;
if (!token) throw new Error("WORKER_TOKEN is required");
if (!["http:", "https:"].includes(app.protocol) || app.username || app.password)
  throw new Error("Invalid APP_URL");
if (
  app.protocol !== "https:" &&
  !["127.0.0.1", "localhost"].includes(app.hostname)
)
  throw new Error("APP_URL must use HTTPS except localhost");
const headers = { Authorization: `Bearer ${token}` };
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function api(path: string, body?: unknown) {
  const response = await fetch(new URL(path, app), {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify(body || {}),
    signal: AbortSignal.timeout(path === "/api/worker/claim" ? 65000 : 15000),
  });
  if (!response.ok)
    throw new Error(`Worker API ${path} returned ${response.status}`);
  return response.json();
}
async function upload(
  recordingId: string,
  kind: string,
  path: string,
  clipId?: string,
) {
  const data = await readFile(path);
  if (data.byteLength > 150 * 1024 * 1024)
    throw new Error("Asset exceeds worker size limit");
  if (process.env.BLOB_CLIENT_UPLOAD === "true") {
    const ext =
        kind === "screenshot" ? "png" : kind === "clip" ? "mp4" : "webm",
      contentType =
        kind === "screenshot"
          ? "image/png"
          : kind === "clip"
            ? "video/mp4"
            : "video/webm";
    const pathname = `worker/${recordingId}/${randomUUID()}.${ext}`;
    const blob = await uploadBlob(
      pathname,
      new Blob([data], { type: contentType }),
      {
        access: "private",
        handleUploadUrl: new URL("/api/worker/blob-upload", app).href,
        headers,
        clientPayload: JSON.stringify({ recordingId, clipId, kind }),
        contentType,
        multipart: true,
        abortSignal: AbortSignal.timeout(120000),
      },
    );
    const result = await api("/api/worker/asset", {
      recordingId,
      clipId,
      kind,
      blobUrl: blob.url,
      pathname: blob.pathname,
      size: data.byteLength,
    });
    if (typeof result.url !== "string") throw new Error("Asset URL missing");
    return result.url as string;
  }
  const form = new FormData();
  form.set("recordingId", recordingId);
  form.set("kind", kind);
  if (clipId) form.set("clipId", clipId);
  form.set(
    "file",
    new Blob([data]),
    kind === "screenshot"
      ? "capture.png"
      : kind === "clip"
        ? "clip.mp4"
        : "recording.webm",
  );
  const res = await fetch(new URL("/api/worker/asset", app), {
    method: "POST",
    headers,
    body: form,
    signal: AbortSignal.timeout(60000),
  });
  if (!res.ok) throw new Error(`Asset upload returned ${res.status}`);
  const result = await res.json();
  if (typeof result.url !== "string") throw new Error("Asset URL missing");
  return result.url as string;
}
type Action = { id: string; label: string };
async function choose(
  state: unknown,
  actions: Action[],
  key: string,
): Promise<string> {
  const criteria = Object.fromEntries(actions.map((a) => [a.id, a.label]));
  const res = await fetch("https://api.typesafe.ai/v1/systemone", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "jev-latest",
      state,
      questions: {
        next: {
          type: "choice",
          instructions:
            "Choose the next gameplay action from the allowed options.",
          criteria,
        },
      },
    }),
    signal: AbortSignal.timeout(12000),
  });
  if (!res.ok) throw new Error(`Jev returned ${res.status}`);
  const json = await res.json();
  const selected = json?.answers?.next?.choice;
  if (typeof selected !== "string" || !actions.some((a) => a.id === selected))
    throw new Error("Jev returned an action outside the allowlist");
  return selected;
}
function fixtureChoice(state: unknown, actions: Action[]): string {
  const s = state as { phase?: string; player?: number; star?: number };
  const id =
    s.phase !== "playing"
      ? "start"
      : (s.player ?? 0) < (s.star ?? 0)
        ? "right"
        : (s.player ?? 0) > (s.star ?? 0)
          ? "left"
          : "wait";
  if (!actions.some((a) => a.id === id))
    throw new Error("Fixture action missing");
  return id;
}
async function bounded<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Adapter timed out")), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer!);
  }
}
class ReportedFailure extends Error {}
async function runRecording(job: any) {
  const { recording, game, jevKey } = job;
  if (!recording?.id || !game?.url) throw new Error("Invalid recording claim");
  if (recording.mode === "jev" && !jevKey)
    throw new Error("Jev key not configured");
  const safe = await validateGameUrl(
    game.url,
    process.env.ALLOW_LOCAL_FIXTURE === "true",
  );
  if (
    recording.mode === "fixture" &&
    (new URL(safe.url).origin !== app.origin ||
      new URL(safe.url).pathname !== "/fixture/index.html")
  )
    throw new Error("Fixture mode is limited to this app’s controlled fixture");
  const dir = await mkdtemp(join(tmpdir(), "game-recording-"));
  let context: BrowserContext | undefined;
  let browser;
  const started = Date.now();
  let leaseValid = true;
  const heartbeat = setInterval(() => {
    void api("/api/worker/heartbeat", { recordingId: recording.id }).catch(
      () => {
        leaseValid = false;
      },
    );
  }, 10000);
  const sessionId = randomUUID(),
    playerId = randomUUID(),
    evidence = new RunEvidence(started);
  const actionsLog: { at: number; id: string }[] = [];
  let lastPhase = "";
  async function event(name: string, properties: Record<string, unknown> = {}) {
    await api("/api/worker/events", {
      recordingId: recording.id,
      events: [
        {
          id: randomUUID(),
          name,
          sessionId,
          playerId,
          timestamp: new Date().toISOString(),
          properties,
          page: safe.url,
          referrer: "",
          source: "worker",
          device: "desktop",
        },
      ],
    });
  }
  try {
    browser = await chromium.launch({
      headless: true,
      args: [
        "--no-proxy-server",
        `--host-resolver-rules=MAP ${safe.host} ${safe.ip}, EXCLUDE localhost`,
      ],
    });
    context = await browser.newContext({
      viewport: { width: 960, height: 540 },
      recordVideo: { dir, size: { width: 960, height: 540 } },
      serviceWorkers: "block",
      acceptDownloads: false,
    });
    const origin = new URL(safe.url).origin;
    await context.route("**/*", async (route) => {
      try {
        const u = new URL(route.request().url());
        if (
          u.origin !== origin ||
          u.username ||
          u.password ||
          (recording.mode === "fixture" &&
            !u.pathname.startsWith("/fixture/") &&
            u.pathname !== "/sdk.js")
        ) {
          evidence.blockedRequest();
          await route.abort();
          return;
        }
        await route.continue();
      } catch {
        await route.abort();
      }
    });
    await context.routeWebSocket("**/*", (ws) => {
      evidence.blockedRequest();
      ws.close();
    });
    const page = await context.newPage();
    page.on("pageerror", (error) => evidence.pageError(error.name));
    page.setDefaultTimeout(5000);
    page.setDefaultNavigationTimeout(15000);
    await page.goto(safe.url, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(
      () => Boolean((window as any).gameMarketingAdapter),
      null,
      { timeout: 10000 },
    );
    await event("visit");
    await event("loaded");
    for (let i = 0; i < 30 && Date.now() - started < 30000; i++) {
      if (!leaseValid) throw new Error("Worker lease heartbeat failed");
      const raw = await bounded(
        page.evaluate(async () => {
          const a = (window as any).gameMarketingAdapter;
          const state = JSON.stringify(await a.getState());
          if (!state || state.length > 8000)
            throw new Error("Adapter state exceeds 8 KB");
          const actions = a.actions;
          if (!Array.isArray(actions) || actions.length > 20)
            throw new Error("Invalid adapter actions");
          return {
            state,
            actions: actions.map((item: any) => ({
              id: typeof item.id === "string" ? item.id.slice(0, 41) : null,
              label:
                typeof item.label === "string"
                  ? item.label.slice(0, 121)
                  : null,
            })),
          };
        }),
        5000,
      );
      const snap = {
        state: JSON.parse(raw.state) as unknown,
        actions: raw.actions,
      };
      if (
        !Array.isArray(snap.actions) ||
        snap.actions.length < 1 ||
        snap.actions.length > 20
      )
        throw new Error("Adapter actions must contain 1–20 choices");
      const actions: Action[] = snap.actions.map((a: any) => ({
        id: a.id,
        label: a.label,
      }));
      if (
        actions.some(
          (a) =>
            typeof a.id !== "string" ||
            !/^[a-zA-Z0-9_-]{1,40}$/.test(a.id) ||
            typeof a.label !== "string" ||
            a.label.length > 120,
        ) ||
        new Set(actions.map((a) => a.id)).size !== actions.length
      )
        throw new Error("Adapter actions invalid");
      const phase = safePhase((snap.state as any)?.phase);
      evidence.state(snap.state, raw.state);
      if (phase === "won" || phase === "complete" || phase === "completed") {
        await event("round_complete", { result: String(phase) });
        break;
      }
      const needsJev = recording.mode === "jev" && actions.length > 1;
      const selected =
        recording.mode === "fixture"
          ? fixtureChoice(snap.state, actions)
          : needsJev
            ? await choose(snap.state, actions, jevKey)
            : actions[0].id;
      if (needsJev) evidence.modelDecision();
      if (!leaseValid) throw new Error("Worker lease heartbeat failed");
      await bounded(
        page.evaluate(async (id) => {
          await (window as any).gameMarketingAdapter.act(id);
        }, selected),
        5000,
      );
      actionsLog.push({ at: evidence.now(), id: selected });
      evidence.action();
      if (!i) {
        await event("first_action");
        await event("round_start");
      }
      if (phase !== lastPhase) {
        await event("progression", { step: "phase_change" });
        lastPhase = phase;
      }
      await sleep(800);
    }
    if (!leaseValid) throw new Error("Worker lease heartbeat failed");
    if (evidence.hasErrors)
      await event("error", { code: "game_page_error" }).catch(() => {});
    const screenshot = join(dir, "capture.png");
    await page.screenshot({ path: screenshot });
    const screenshotAt = evidence.now();
    const video = page.video();
    if (!video) throw new Error("Playwright video unavailable");
    await event("exit");
    await context.close();
    context = undefined;
    const videoPath = await video.path();
    const screenshotUrl = await upload(recording.id, "screenshot", screenshot),
      videoUrl = await upload(recording.id, "video", videoPath);
    await api("/api/worker/complete", {
      recordingId: recording.id,
      status: "ready",
      duration: Math.round((Date.now() - started) / 1000),
      videoUrl,
      screenshotUrl,
      actions: actionsLog,
      observations: evidence.finish({
        fixture: recording.mode === "fixture",
        screenshotUrl,
        screenshotAt,
      }),
    });
  } catch (error) {
    const code = failureCode(error);
    await event("error", { code }).catch(() => {});
    try {
      await api("/api/worker/complete", {
        recordingId: recording.id,
        status: "failed",
        duration: evidence.now(),
        error: code,
        actions: actionsLog,
        observations: evidence.finish({
          fixture: recording.mode === "fixture",
          failure: code,
        }),
      });
      throw new ReportedFailure();
    } catch (reportError) {
      if (reportError instanceof ReportedFailure) throw reportError;
      throw error;
    }
  } finally {
    clearInterval(heartbeat);
    if (context) await context.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
    await rm(dir, { recursive: true, force: true });
  }
}
async function runClip(job: any) {
  const { clip, recording } = job;
  if (!clip?.id || !recording?.id || !recording.videoUrl)
    throw new Error("Clip source unavailable");
  const start = Number(clip.start),
    end = Number(clip.end);
  if (
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    start < 0 ||
    end <= start ||
    end - start > 60 ||
    !["landscape", "portrait", "square"].includes(clip.layout)
  )
    throw new Error("Invalid clip bounds or layout");
  const media = new URL(recording.videoUrl, app);
  if (media.origin !== app.origin || !media.pathname.startsWith("/api/media/"))
    throw new Error("Untrusted clip source");
  let leaseValid = true;
  const heartbeat = setInterval(() => {
    void api("/api/worker/heartbeat", { clipId: clip.id }).catch(() => {
      leaseValid = false;
    });
  }, 10000);
  const dir = await mkdtemp(join(tmpdir(), "game-clip-"));
  try {
    const parts: Buffer[] = [];
    let offset = 0,
      total = Infinity;
    const chunkSize = 2 * 1024 * 1024;
    while (offset < total) {
      const res = await fetch(media, {
        headers: {
          ...headers,
          Range: `bytes=${offset}-${offset + chunkSize - 1}`,
        },
        signal: AbortSignal.timeout(30000),
        redirect: "error",
      });
      if (!res.ok) throw new Error(`Source download returned ${res.status}`);
      const bytes = Buffer.from(await res.arrayBuffer());
      if (res.status === 200) {
        if (offset !== 0 || bytes.length > chunkSize)
          throw new Error("Media server did not support bounded ranges");
        total = bytes.length;
      } else {
        const match = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(
          res.headers.get("content-range") || "",
        );
        if (
          !match ||
          Number(match[1]) !== offset ||
          Number(match[2]) - offset + 1 !== bytes.length
        )
          throw new Error("Invalid media range");
        total = Number(match[3]);
      }
      if (!bytes.length || total > 150 * 1024 * 1024)
        throw new Error("Source video empty or too large");
      parts.push(bytes);
      offset += bytes.length;
    }
    const input = join(dir, "source.webm"),
      output = join(dir, "clip.mp4");
    await writeFile(input, Buffer.concat(parts));
    const dimensions =
      clip.layout === "portrait"
        ? "720:1280"
        : clip.layout === "square"
          ? "720:720"
          : "1280:720";
    const require = createRequire(import.meta.url);
    const ffmpeg = require("ffmpeg-static") as string;
    if (!ffmpeg) throw new Error("ffmpeg is unavailable");
    await new Promise<void>((resolve, reject) => {
      const child = spawn(
        ffmpeg,
        [
          "-v",
          "error",
          "-ss",
          String(start),
          "-i",
          input,
          "-t",
          String(end - start),
          "-vf",
          `scale=${dimensions}:force_original_aspect_ratio=decrease,pad=${dimensions}:(ow-iw)/2:(oh-ih)/2:black`,
          "-c:v",
          "libx264",
          "-pix_fmt",
          "yuv420p",
          "-an",
          "-y",
          output,
        ],
        { stdio: "ignore" },
      );
      const timer = setTimeout(() => child.kill("SIGKILL"), 60000);
      child.on("error", (e) => {
        clearTimeout(timer);
        reject(e);
      });
      child.on("exit", (code) => {
        clearTimeout(timer);
        code === 0 ? resolve() : reject(new Error("Clip encoding failed"));
      });
    });
    if (!leaseValid) throw new Error("Worker lease heartbeat failed");
    const videoUrl = await upload(recording.id, "clip", output, clip.id);
    await api("/api/worker/complete", {
      clipId: clip.id,
      status: "ready",
      videoUrl,
    });
  } finally {
    clearInterval(heartbeat);
    await rm(dir, { recursive: true, force: true });
  }
}
async function main() {
  for (;;) {
    let job: any;
    try {
      job = await api("/api/worker/claim");
      if (!job.recording && !job.clip) {
        await sleep(5000);
        continue;
      }
      try {
        if (job.clip) await runClip(job);
        else await runRecording(job);
      } catch (error) {
        if (error instanceof ReportedFailure) continue;
        const code = failureCode(error);
        await api(
          "/api/worker/complete",
          job.clip
            ? { clipId: job.clip.id, status: "failed", error: code }
            : {
                recordingId: job.recording.id,
                status: "failed",
                error: code,
                observations: [
                  {
                    at: 0,
                    text: `Recording stopped with worker code ${code}.`,
                    type: "error",
                  },
                ],
              },
        );
      }
    } catch {
      console.error("Worker request failed; retrying");
      await sleep(5000);
    }
  }
}
void main();
