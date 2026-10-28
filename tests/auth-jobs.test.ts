import { beforeAll, beforeEach, describe, it, expect, vi } from "vitest";
const jar = vi.hoisted(() => new Map<string, string>());
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (key: string) => (jar.has(key) ? { value: jar.get(key) } : undefined),
    set: (key: string, value: string) => jar.set(key, value),
    delete: (key: string) => jar.delete(key),
  }),
}));
vi.mock("../src/lib/integrations", () => ({
  runResearch: async () => ({
    findings: [],
    coverage: [
      { source: "fixture", status: "complete", detail: "Mocked source" },
    ],
    fingerprint: "test",
  }),
}));
let db: typeof import("../src/lib/db"),
  auth: typeof import("../src/lib/auth"),
  jobs: typeof import("../src/lib/research-jobs");
beforeAll(async () => {
  delete process.env.DATABASE_URL;
  delete process.env.VERCEL;
  process.env.LOCAL_DATABASE_PATH = "memory://";
  db = await import("../src/lib/db");
  auth = await import("../src/lib/auth");
  jobs = await import("../src/lib/research-jobs");
});
beforeEach(async () => {
  jar.clear();
  await db.query("DELETE FROM auth_sessions");
  await db.query("DELETE FROM users");
  await db.query("DELETE FROM records");
  await db.query("DELETE FROM jobs");
  await db.query("DELETE FROM daily_runs");
});
describe("authentication and daily job isolation", () => {
  it("preserves strict PostgreSQL TLS verification explicitly", () => {
    for (const mode of ["prefer", "require", "verify-ca", "verify-full"]) {
      const url = new URL(
        db.postgresConnectionString(
          `postgresql://test:fake@database.example/studio?sslmode=${mode}&channel_binding=require`,
        ),
      );
      expect(url.searchParams.get("sslmode")).toBe("verify-full");
      expect(url.searchParams.get("channel_binding")).toBe("require");
      expect(url.hostname).toBe("database.example");
    }
  });
  it("commits recording records and queue entries atomically", async () => {
    const { enqueue } = await import("../src/lib/jobs");
    const body = { id: "atomic-recording", title: "Fixture", status: "queued" };
    await enqueue("ws-a", "recording", body);
    expect(await db.get("ws-a", "recording", body.id)).toEqual(body);
    await db.query(
      "INSERT INTO jobs(id,workspace_id,kind,state,body) VALUES('conflict-job','ws-a','recording','queued','{}')",
    );
    const conflicting = { id: "conflict-job", title: "Must roll back" };
    await expect(enqueue("ws-a", "recording", conflicting)).rejects.toThrow();
    expect(await db.get("ws-a", "recording", conflicting.id)).toBeUndefined();
  });
  it("creates independent opaque sessions and expires them server-side", async () => {
    const a = await auth.createSession({
      id: "google:user-a",
      email: "a@example.test",
      name: "A",
    });
    const tokenA = jar.get("studio_session")!;
    expect((await auth.identity())?.workspace_id).toBe(a.workspace_id);
    const b = await auth.createSession({
      id: "google:user-b",
      email: "b@example.test",
      name: "B",
    });
    expect(b.workspace_id).not.toBe(a.workspace_id);
    expect(jar.get("studio_session")).not.toBe(tokenA);
    jar.set("studio_session", tokenA);
    expect((await auth.identity())?.id).toBe(a.id);
    await db.query(
      "UPDATE auth_sessions SET expires_at=now()-interval '1 second'",
    );
    expect(await auth.identity()).toBeNull();
  });
  it("queues every daily game idempotently without the old 30-game cutoff", async () => {
    for (let i = 0; i < 35; i++)
      await db.put(i % 2 ? "ws-a" : "ws-b", "game", {
        id: `game-${i}`,
        title: "test",
        url: "https://game.example",
        description: "",
        image: "",
        genre: "",
        sdkKey: `key-${i}`,
        origins: [],
        createdAt: "",
        dailyEnabled: true,
        competitors: [],
      });
    expect(await jobs.queueDailyResearch()).toBe(35);
    await jobs.queueDailyResearch();
    expect(
      await db.query("SELECT id FROM jobs WHERE kind='research'"),
    ).toHaveLength(35);
    await jobs.drainResearch(2);
    expect(
      await db.query(
        "SELECT id FROM jobs WHERE kind='research' AND state='complete'",
      ),
    ).toHaveLength(2);
    expect(
      await db.query(
        "SELECT id FROM jobs WHERE kind='research' AND state='queued'",
      ),
    ).toHaveLength(33);
  });
  it("requeues a recovered job while the daily run lease is still active", async () => {
    const game = {
      id: "recover-game",
      title: "test",
      url: "https://game.example",
      description: "",
      image: "",
      genre: "",
      sdkKey: "key",
      origins: [],
      createdAt: "",
      dailyEnabled: true,
      competitors: [],
    };
    await db.put("ws-a", "game", game);
    await jobs.queueDailyResearch();
    const day = new Date().toISOString().slice(0, 10);
    await db.query(
      "INSERT INTO daily_runs(workspace_id,game_id,day,run_id,lease_until) VALUES('ws-a',$1,$2,'lost-run',now()+interval '1 minute')",
      [game.id, day],
    );
    await jobs.drainResearch(1);
    const job = (
      await db.query<{ state: string; available_at: Date }>(
        "SELECT state,available_at FROM jobs WHERE kind='research'",
      )
    )[0];
    expect(job.state).toBe("queued");
    expect(new Date(job.available_at).getTime()).toBeGreaterThan(Date.now());
  });
});
