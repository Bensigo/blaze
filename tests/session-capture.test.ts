import {
  beforeAll,
  beforeEach,
  afterEach,
  afterAll,
  describe,
  it,
  expect,
  vi,
} from "vitest";
import { randomBytes } from "node:crypto";
import type { Game, SessionCapture } from "../src/lib/types";
vi.mock("../src/lib/capture-video", () => ({
  inspectCaptureVideo: async () => ({
    durationSeconds: 2,
    width: 320,
    height: 180,
    fps: 5,
    contentType: "video/webm",
  }),
}));
const jar = vi.hoisted(() => new Map<string, string>());
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (k: string) => (jar.has(k) ? { value: jar.get(k) } : undefined),
    set: (k: string, v: string) => jar.set(k, v),
    delete: (k: string) => jar.delete(k),
  }),
}));
let db: typeof import("../src/lib/db"),
  capture: typeof import("../src/lib/session-capture"),
  media: typeof import("../src/lib/media"),
  auth: typeof import("../src/lib/auth");
const env = {
  DATABASE_URL: process.env.DATABASE_URL,
  VERCEL: process.env.VERCEL,
  LOCAL_DATABASE_PATH: process.env.LOCAL_DATABASE_PATH,
  CREDENTIAL_KEY: process.env.CREDENTIAL_KEY,
  BLOB_READ_WRITE_TOKEN: process.env.BLOB_READ_WRITE_TOKEN,
  WORKER_TOKEN: process.env.WORKER_TOKEN,
};
const origin = "https://game.example",
  gameId = "game-capture-test",
  ws = "ws-capture-test";
let game: Game;
beforeAll(async () => {
  delete process.env.DATABASE_URL;
  delete process.env.VERCEL;
  delete process.env.BLOB_READ_WRITE_TOKEN;
  process.env.LOCAL_DATABASE_PATH = "memory://";
  process.env.CREDENTIAL_KEY = randomBytes(32).toString("base64");
  process.env.WORKER_TOKEN = "unit-worker-token";
  db = await import("../src/lib/db");
  capture = await import("../src/lib/session-capture");
  media = await import("../src/lib/media");
  auth = await import("../src/lib/auth");
});
beforeEach(async () => {
  jar.clear();
  for (const row of await db.list<import("../src/lib/media").MediaRecord>(
    ws,
    "media",
  ))
    await media.deleteAsset(ws, `/api/media/${row.id}`, row.captureId);
  for (const table of [
    "auth_sessions",
    "users",
    "records",
    "events",
    "session_capture_grants",
    "rate_windows",
  ])
    await db.query(`DELETE FROM ${table}`);
  game = {
    id: gameId,
    title: "Capture fixture",
    url: origin + "/game",
    description: "",
    image: "",
    genre: "fixture",
    sdkKey: "sdk_01234567890123456789012345678901",
    origins: [origin],
    createdAt: new Date().toISOString(),
    dailyEnabled: false,
    competitors: [],
    capture: {
      ...capture.defaultCaptureConfig,
      enabled: true,
      canvasSelector: "#game",
      surfaceReviewed: true,
      sampleRate: 1,
    },
  };
  await db.put(ws, "game", game);
});
afterEach(() => vi.restoreAllMocks());
afterAll(async () => {
  for (const row of await db.list<import("../src/lib/media").MediaRecord>(
    ws,
    "media",
  ))
    await media.deleteAsset(ws, `/api/media/${row.id}`, row.captureId);
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});
async function visit(sessionId = "session-human-test", kind = "human") {
  await db.query(
    `INSERT INTO events(id,workspace_id,game_id,session_id,player_id,kind,name,occurred_at,country,device,source,campaign,page,properties) VALUES($1,$2,$3,$4,'player-human-test',$5,'visit',now(),'Unknown','desktop','Direct','',$6,'{}')`,
    [db.id("event"), ws, gameId, sessionId, kind, origin + "/game"],
  );
  return sessionId;
}
async function grant(sessionId = "session-human-test") {
  await visit(sessionId);
  return (await capture.startCapture(
    { sdkKey: game.sdkKey, sessionId, consent: true },
    origin,
  )) as { status: string; captureId: string; token: string };
}
function form(
  g: { captureId: string; token: string },
  options: { size?: number; duration?: number; width?: number } = {},
) {
  const f = new FormData();
  f.set("captureId", g.captureId);
  f.set("token", g.token);
  const bytes = new Uint8Array(options.size || 32);
  bytes.set([0x1a, 0x45, 0xdf, 0xa3]);
  f.set("file", new File([bytes], "capture.webm", { type: "video/webm" }));
  f.set("durationSeconds", String(options.duration || 2));
  f.set("width", String(options.width || 320));
  f.set("height", "180");
  return f;
}
describe("human capture configuration and grants", () => {
  it("requires owner enablement, recording consent, allowed origin and a received human visit", async () => {
    await expect(
      capture.startCapture(
        { sdkKey: game.sdkKey, sessionId: "session-human-test", consent: true },
        origin,
      ),
    ).rejects.toThrow("received");
    await visit();
    await expect(
      capture.startCapture(
        {
          sdkKey: game.sdkKey,
          sessionId: "session-human-test",
          consent: false,
        },
        origin,
      ),
    ).rejects.toThrow();
    await expect(
      capture.startCapture(
        { sdkKey: game.sdkKey, sessionId: "session-human-test", consent: true },
        "https://foreign.example",
      ),
    ).rejects.toThrow("not authorized");
    await db.put(ws, "game", {
      ...game,
      capture: { ...game.capture!, enabled: false },
    });
    expect(
      await capture.startCapture(
        { sdkKey: game.sdkKey, sessionId: "session-human-test", consent: true },
        origin,
      ),
    ).toEqual({ status: "disabled" });
    expect(await db.query("SELECT * FROM session_capture_grants")).toHaveLength(
      0,
    );
  });
  it("rejects agent events even with a normal-looking session id", async () => {
    await visit("session-agent-test", "agent");
    await expect(
      capture.startCapture(
        { sdkKey: game.sdkKey, sessionId: "session-agent-test", consent: true },
        origin,
      ),
    ).rejects.toThrow("human session");
    expect(await db.query("SELECT * FROM session_capture_grants")).toHaveLength(
      0,
    );
  });
  it("issues one scoped expiring grant without storing a plaintext token", async () => {
    const g = await grant();
    expect(g.status).toBe("pending");
    const stored = (
      await db.query<{ token_hash: string }>(
        "SELECT token_hash FROM session_capture_grants",
      )
    )[0];
    expect(stored.token_hash).not.toBe(g.token);
    const body = await db.get(ws, "session_capture", g.captureId);
    expect(JSON.stringify(body)).not.toContain(g.token);
    await expect(
      capture.startCapture(
        { sdkKey: game.sdkKey, sessionId: "session-human-test", consent: true },
        origin,
      ),
    ).rejects.toThrow("already");
    await expect(
      capture.uploadCapture(form({ ...g, token: "wrong-token" }), origin),
    ).rejects.toThrow("not authorized");
    await expect(
      capture.uploadCapture(form(g), "https://foreign.example"),
    ).rejects.toThrow("not authorized");
    await db.query(
      "UPDATE session_capture_grants SET expires_at=now()-interval '1 second'",
    );
    await expect(capture.uploadCapture(form(g), origin)).rejects.toThrow(
      "expired",
    );
  });
  it("bounds bytes, dimensions, duration, quota and configuration", async () => {
    const g = await grant();
    await expect(
      capture.uploadCapture(
        form(g, { size: capture.CAPTURE_MAX_BYTES + 1 }),
        origin,
      ),
    ).rejects.toThrow("3 MiB");
    await expect(
      capture.uploadCapture(form(g, { duration: 31 }), origin),
    ).rejects.toThrow("limits");
    await expect(
      capture.uploadCapture(form(g, { width: 961 }), origin),
    ).rejects.toThrow("limits");
    await db.put(ws, "game", {
      ...game,
      capture: { ...game.capture!, maxCapturesPerDay: 1 },
    });
    const s = await visit("session-quota-test");
    expect(
      (
        await capture.startCapture(
          { sdkKey: game.sdkKey, sessionId: s, consent: true },
          origin,
        )
      ).status,
    ).toBe("quota_reached");
    expect(() =>
      capture.captureConfigSchema.parse({
        ...game.capture,
        canvasSelector: "",
        enabled: true,
      }),
    ).toThrow();
  });
});
describe("recording start time", () => {
  it("stores the recorder timestamp, rejects invalid and out-of-window values, and supports older uploads", async () => {
    const g = await grant();
    for (const bad of ["not-a-date", new Date(Date.now()+301000).toISOString(), new Date(Date.now()-301000).toISOString()]) {
      const f=form(g); f.set("recordedAt",bad);
      await expect(capture.uploadCapture(f,origin)).rejects.toThrow(/start time/);
    }
    const timestamp=new Date().toISOString(); const valid=form(g); valid.set("recordedAt",timestamp);
    await capture.uploadCapture(valid,origin);
    expect((await db.get<SessionCapture>(ws,"session_capture",g.captureId))?.recordedAt).toBe(timestamp);
  });
  it("checks the start against grant time independently of the current clock", async () => {
    const g=await grant(); const cap=(await db.get<SessionCapture>(ws,"session_capture",g.captureId))!;
    await db.put(ws,"session_capture",{...cap,createdAt:new Date(Date.now()-301000).toISOString()});
    const f=form(g); f.set("recordedAt",new Date().toISOString());
    await expect(capture.uploadCapture(f,origin)).rejects.toThrow(/outside the allowed window/);
  });
  it("preserves no timestamp for older SDK uploads",async()=>{
    const g=await grant(); await capture.uploadCapture(form(g),origin);
    expect((await db.get<SessionCapture>(ws,"session_capture",g.captureId))?.recordedAt).toBeUndefined();
  });
});
describe("private human playback and revocation", () => {
  it("stores under the human session, supports owner playback, denies foreign/anonymous/worker/public-share access", async () => {
    const user = await auth.createSession({
      id: "owner-capture",
      email: "owner@example.invalid",
      name: "Owner",
    });
    await db.query("UPDATE users SET workspace_id=$1 WHERE id=$2", [
      ws,
      user.id,
    ]);
    const ownerCookie = jar.get("studio_session")!;
    const g = await grant();
    expect(await capture.uploadCapture(form(g), origin)).toEqual({
      status: "ready",
      captureId: g.captureId,
    });
    const cap = await db.get<SessionCapture>(
      ws,
      "session_capture",
      g.captureId,
    );
    expect(cap?.status).toBe("ready");
    expect(
      await db.query("SELECT kind FROM events WHERE kind='agent'"),
    ).toHaveLength(0);
    await expect(capture.uploadCapture(form(g), origin)).rejects.toThrow(
      "no longer",
    );
    const mid = cap!.videoUrl!.split("/").pop()!;
    const route = await import("../src/app/api/media/[id]/route");
    const sessionRoute = await import("../src/app/api/sessions/[id]/route");
    const playback = await route.GET(
      new Request("https://studio.example/api/media/" + mid, {
        headers: { Range: "bytes=0-7" },
      }),
      { params: Promise.resolve({ id: mid }) },
    );
    expect(playback.status).toBe(206);
    const details = await sessionRoute.GET(
      new Request(
        "https://studio.example/api/sessions/session-human-test?gameId=" +
          gameId,
      ),
      { params: Promise.resolve({ id: "session-human-test" }) },
    );
    expect((await details.json()).capture.videoUrl).toBe(cap!.videoUrl);
    jar.clear();
    expect(
      (
        await route.GET(new Request("https://studio.example/media"), {
          params: Promise.resolve({ id: mid }),
        })
      ).status,
    ).toBe(401);
    expect(
      (
        await route.GET(
          new Request("https://studio.example/media", {
            headers: { Authorization: "Bearer unit-worker-token" },
          }),
          { params: Promise.resolve({ id: mid }) },
        )
      ).status,
    ).toBe(401);
    await auth.createSession({
      id: "foreign-owner",
      email: "foreign@example.invalid",
      name: "Foreign",
    });
    expect(
      (
        await route.GET(new Request("https://studio.example/media"), {
          params: Promise.resolve({ id: mid }),
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await sessionRoute.GET(
          new Request(
            "https://studio.example/api/sessions/session-human-test?gameId=" +
              gameId,
          ),
          { params: Promise.resolve({ id: "session-human-test" }) },
        )
      ).status,
    ).toBe(404);
    jar.set("studio_session", ownerCookie);
    const security = await import("../src/lib/security");
    const expires = Date.now() + 60000;
    const share = await import("../src/app/api/share-media/[id]/route");
    expect(
      (
        await share.GET(
          new Request(
            `https://studio.example/api/share-media/${mid}?expires=${expires}&signature=${await security.signMedia(mid, expires)}`,
          ),
          { params: Promise.resolve({ id: mid }) },
        )
      ).status,
    ).toBe(404);
    await capture.deleteOwnerCapture(ws, g.captureId);
    expect(
      (
        await route.GET(new Request("https://studio.example/media"), {
          params: Promise.resolve({ id: mid }),
        })
      ).status,
    ).toBe(404);
  });
  it("wins an upload/cancel race without publishing or leaving its media", async () => {
    const g = await grant();
    const original = media.saveAsset;
    let release!: () => void, entered!: () => void;
    const gate = new Promise<void>((r) => (release = r)),
      started = new Promise<void>((r) => (entered = r));
    vi.spyOn(media, "saveAsset").mockImplementation(async (...args) => {
      entered();
      await gate;
      return original(...args);
    });
    const uploading = capture.uploadCapture(form(g), origin);
    await started;
    await capture.cancelCapture(g, origin);
    release();
    await expect(uploading).rejects.toThrow("withdrawn");
    expect(
      (await db.get<SessionCapture>(ws, "session_capture", g.captureId))
        ?.status,
    ).toBe("cancelled");
    expect(await db.list(ws, "media")).toHaveLength(0);
  });
  it("expires media immediately and physically cleans it up", async () => {
    const g = await grant();
    await capture.uploadCapture(form(g), origin);
    const cap = (await db.get<SessionCapture>(
      ws,
      "session_capture",
      g.captureId,
    ))!;
    const mid = cap.videoUrl!.split("/").pop()!;
    const asset = (await media.mediaRecord(ws, mid))!;
    await db.put(ws, "media", {
      ...asset,
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    });
    await db.put(ws, "session_capture", {
      ...cap,
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    });
    expect(
      (
        await media.serveMedia(
          { ...asset, expiresAt: new Date(Date.now() - 1000).toISOString() },
          new Request("https://studio.example/media"),
        )
      ).status,
    ).toBe(410);
    await capture.cleanupCaptures();
    expect(
      (await db.get<SessionCapture>(ws, "session_capture", g.captureId))
        ?.status,
    ).toBe("expired");
    expect(await media.mediaRecord(ws, mid)).toBeUndefined();
  });
});
