import { beforeAll, beforeEach, describe, it, expect, vi } from "vitest";
const jar = vi.hoisted(() => new Map<string, string>());
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (key: string) => (jar.has(key) ? { value: jar.get(key) } : undefined),
    set: (key: string, value: string) => jar.set(key, value),
    delete: (key: string) => jar.delete(key),
  }),
}));
let db: typeof import("../src/lib/db"),
  auth: typeof import("../src/lib/auth");
beforeAll(async () => {
  delete process.env.DATABASE_URL;
  delete process.env.VERCEL;
  process.env.LOCAL_DATABASE_PATH = "memory://";
  db = await import("../src/lib/db");
  auth = await import("../src/lib/auth");
});
beforeEach(async () => {
  jar.clear();
  await db.query("DELETE FROM auth_sessions");
  await db.query("DELETE FROM users");
  await db.query("DELETE FROM records");
  await db.query("DELETE FROM jobs");
  await db.query("DELETE FROM daily_runs");
});
describe("authentication", () => {
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
});
