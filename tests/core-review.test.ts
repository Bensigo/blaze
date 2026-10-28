import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { randomBytes } from "node:crypto";
import type { Game, Post, Connection, Clip } from "../src/lib/types";
const adapters = vi.hoisted(() => ({
  publishPost: vi.fn(),
  checkPublication: vi.fn(),
}));
vi.mock("../src/lib/integrations", () => adapters);
const envBefore = {
  DATABASE_URL: process.env.DATABASE_URL,
  VERCEL: process.env.VERCEL,
  LOCAL_DATABASE_PATH: process.env.LOCAL_DATABASE_PATH,
  CREDENTIAL_KEY: process.env.CREDENTIAL_KEY,
  PUBLISHING_ENABLED: process.env.PUBLISHING_ENABLED,
};
let db: typeof import("../src/lib/db");
let credentials: typeof import("../src/lib/credentials");
let security: typeof import("../src/lib/security");
let publishing: typeof import("../src/lib/publishing");
const game: Game = {
  id: "game_review",
  title: "Test",
  url: "https://game.example",
  description: "",
  image: "",
  genre: "",
  sdkKey: "sdk-test",
  origins: [],
  createdAt: "",
  dailyEnabled: false,
  competitors: [],
};
const connection: Connection = {
  id: "connection_review",
  provider: "x",
  label: "Account",
  accountId: "account_review",
  connected: true,
};
const base: Post = {
  id: "post_review",
  gameId: game.id,
  channel: "x",
  text: "Approved text",
  accountId: "account_review",
  status: "approved",
  createdAt: "2026-01-01T00:00:00Z",
  campaignId: "campaign",
  approvedAt: "2026-01-01T00:00:00Z",
  approvedBy: "owner",
};
function approved(post: Post = base): Post {
  return { ...post, approvedHash: publishing.approvalHash(post) };
}
beforeAll(async () => {
  delete process.env.DATABASE_URL;
  delete process.env.VERCEL;
  process.env.LOCAL_DATABASE_PATH = "memory://";
  process.env.CREDENTIAL_KEY = randomBytes(32).toString("base64");
  process.env.PUBLISHING_ENABLED = "true";
  db = await import("../src/lib/db");
  credentials = await import("../src/lib/credentials");
  security = await import("../src/lib/security");
  publishing = await import("../src/lib/publishing");
}, 30000);
afterAll(() => {
  for (const [name, value] of Object.entries(envBefore)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});
beforeEach(async () => {
  vi.clearAllMocks();
  await db.query("DELETE FROM publish_dispatches");
  await db.query("DELETE FROM credentials");
  await db.query("DELETE FROM records");
  await db.put("ws-a", "game", game);
  await db.put("ws-a", "connection", connection);
  await credentials.saveSecret("ws-a", connection.id, {
    token: "private-token-12345",
    accountId: "account_review",
  });
});
describe("workspace isolation and encrypted credentials", () => {
  it("isolates identical IDs and rejects stale updates", async () => {
    const a = { id: "same", value: "a" },
      b = { id: "same", value: "b" };
    await db.put("ws-a", "record", a);
    await db.put("ws-b", "record", b);
    expect(
      await db.comparePut("ws-a", "record", b, { ...b, value: "wrong" }),
    ).toBe(false);
    expect(
      await db.comparePut("ws-a", "record", a, { ...a, value: "changed" }),
    ).toBe(true);
    expect(
      await db.comparePut("ws-a", "record", a, { ...a, value: "stale" }),
    ).toBe(false);
    expect(await db.get("ws-b", "record", "same")).toEqual(b);
    expect(await db.get("ws-c", "record", "same")).toBeUndefined();
  });
  it("encrypts secrets and enforces workspace/account lookup", async () => {
    const row = (
      await db.query<{ encrypted: string }>(
        "SELECT encrypted FROM credentials WHERE workspace_id=$1",
        ["ws-a"],
      )
    )[0];
    expect(row.encrypted).not.toContain("private-token-12345");
    expect(await security.decrypt(row.encrypted)).toMatchObject({
      token: "private-token-12345",
    });
    expect(
      await credentials.secretFor("ws-b", "x", "account_review"),
    ).toBeUndefined();
    expect(await credentials.secretFor("ws-a", "x", "wrong")).toBeUndefined();
    const parts = row.encrypted.split(".");
    const encrypted = Buffer.from(parts[2], "base64");
    encrypted[0] ^= 1;
    parts[2] = encrypted.toString("base64");
    await expect(security.decrypt(parts.join("."))).rejects.toThrow();
  });
});
describe("publication approval and concurrency", () => {
  it("rejects unapproved, changed, and foreign workspace posts without provider calls", async () => {
    const p = approved();
    await db.put("ws-a", "post", { ...p, text: "Changed after approval" });
    await expect(publishing.dispatch("ws-a", p.id)).rejects.toThrow(
      "needs approval",
    );
    await expect(publishing.dispatch("ws-b", p.id)).rejects.toThrow(
      "not found",
    );
    expect(adapters.publishPost).not.toHaveBeenCalled();
    expect(
      publishing.approvalValid({ ...p, scheduledAt: "2027-01-01T00:00:00Z" }),
    ).toBe(false);
    expect(publishing.approvalValid({ ...p, accountId: "other" })).toBe(false);
    expect(publishing.approvalValid({ ...p, clipId: "other-clip" })).toBe(
      false,
    );
    expect(publishing.approvalValid({ ...p, channel: "youtube" })).toBe(false);
  });
  it("reserves once under competing dispatches and does not overwrite concurrent changes", async () => {
    const p = approved();
    await db.put("ws-a", "post", p);
    let release!: (v: { state: "processing"; providerId: string }) => void;
    let started!: () => void;
    const startedPromise = new Promise<void>((r) => {
      started = r;
    });
    adapters.publishPost.mockImplementation(() => {
      started();
      return new Promise((r) => {
        release = r;
      });
    });
    const first = publishing.dispatch("ws-a", p.id);
    await startedPromise;
    await expect(publishing.dispatch("ws-a", p.id)).rejects.toThrow();
    expect(adapters.publishPost).toHaveBeenCalledTimes(1);
    const locked = await db.get<Post>("ws-a", "post", p.id);
    expect(locked?.status).toBe("uploading");
    const concurrent = { ...locked!, text: "Concurrent change" };
    expect(await db.comparePut("ws-a", "post", locked!, concurrent)).toBe(true);
    release({ state: "processing", providerId: "123" });
    await expect(first).rejects.toThrow("changed while");
    expect((await db.get<Post>("ws-a", "post", p.id))?.text).toBe(
      "Concurrent change",
    );
  });
  it("never retries an uncertain publication that has no provider ID", async () => {
    const post = approved();
    await db.put("ws-a", "post", post);
    adapters.publishPost.mockResolvedValue({
      state: "processing",
      error:
        "Provider request outcome is uncertain; reconcile manually before retrying.",
    });
    const saved = await publishing.dispatch("ws-a", post.id);
    expect(saved.providerId).toBeUndefined();
    await publishing.reconcile("ws-a", saved);
    expect(adapters.publishPost).toHaveBeenCalledTimes(1);
    expect(adapters.checkPublication).not.toHaveBeenCalled();
    await expect(publishing.dispatch("ws-a", post.id)).rejects.toThrow();
  });
  it("dispatches a ready media publication at most once across competing checks", async () => {
    const clip: Clip = {
      id: "clip_review",
      gameId: game.id,
      recordingId: "rec_review",
      title: "clip",
      start: 0,
      end: 1,
      layout: "landscape",
      status: "ready",
      videoUrl: "/api/media/media_abc",
      createdAt: "",
    };
    await db.put("ws-a", "clip", clip);
    // Use a real local media record without network; this file is only read by the private media helper.
    const { mkdtemp, writeFile, rm } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const dir = await mkdtemp(join(tmpdir(), "core-review-"));
    try {
      const path = join(dir, "clip.mp4");
      await writeFile(path, Buffer.from("fake video"));
      await db.put("ws-a", "media", {
        id: "media_abc",
        recordingId: "rec_review",
        clipId: clip.id,
        kind: "clip",
        contentType: "video/mp4",
        size: 10,
        location: path,
        backend: "local",
        createdAt: "",
      });
      const post = approved({
        ...base,
        clipId: clip.id,
        status: "processing",
        providerId: "x-media:123",
      });
      await db.put("ws-a", "post", post);
      adapters.checkPublication.mockResolvedValue({
        state: "processing",
        providerId: "x-media:123",
        error: "Media ready; a separately reserved post step is required.",
      });
      adapters.publishPost.mockResolvedValue({
        state: "processing",
        providerId: "456",
      });
      await Promise.allSettled([
        publishing.reconcile("ws-a", post),
        publishing.reconcile("ws-a", post),
      ]);
      expect(adapters.publishPost).toHaveBeenCalledTimes(1);
      expect((await db.get<Post>("ws-a", "post", post.id))?.providerId).toBe(
        "456",
      );
      const reservations = await db.query(
        "SELECT * FROM publish_dispatches WHERE workspace_id=$1",
        ["ws-a"],
      );
      expect(reservations).toHaveLength(1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
