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
  auth: typeof import("../src/lib/auth"),
  ws: typeof import("../src/lib/workspaces"),
  route: typeof import("../src/app/api/workspaces/route");
beforeAll(async () => {
  delete process.env.DATABASE_URL;
  delete process.env.VERCEL;
  process.env.LOCAL_DATABASE_PATH = "memory://";
  db = await import("../src/lib/db");
  auth = await import("../src/lib/auth");
  ws = await import("../src/lib/workspaces");
  route = await import("../src/app/api/workspaces/route");
});
beforeEach(async () => {
  jar.clear();
  await db.query("DELETE FROM auth_sessions");
  await db.query("DELETE FROM users");
  await db.query("DELETE FROM records");
  await db.query("DELETE FROM rate_windows");
});
const signIn = async (who: string) => {
  jar.delete(ws.ACTIVE_WORKSPACE_COOKIE);
  await auth.createSession({ id: `google:${who}`, email: `${who}@example.test`, name: who });
  return (await auth.identity())!;
};
const post = (body: unknown, origin = "http://localhost") =>
  route.POST(new Request("http://localhost/api/workspaces", { method: "POST", headers: { "Content-Type": "application/json", Origin: origin }, body: JSON.stringify(body) }));

describe("several workspaces per account", () => {
  it("starts with the account's own workspace, active", async () => {
    const a = await signIn("a");
    expect(a.home_workspace_id).toBe(a.workspace_id);
    expect(await ws.listWorkspaces(a)).toEqual([{ id: a.workspace_id, name: "Your workspace", home: true, active: true }]);
  });

  it("creates a workspace, works in it, and switches back", async () => {
    const a = await signIn("a");
    const home = a.workspace_id;
    await db.put(home, "game", { id: "game_forever", title: "Forever game" });
    const made = await ws.createWorkspace(a, "  cafeclub  ");
    await ws.setActiveWorkspace(a, made);
    const inNew = (await auth.identity())!;
    expect(inNew.workspace_id).toBe(made);
    expect(inNew.home_workspace_id).toBe(home);
    // Records follow the active workspace: the home workspace's game isn't here.
    expect(await db.list(inNew.workspace_id, "game")).toEqual([]);
    expect(await ws.activeWorkspaceName(inNew)).toBe("cafeclub");
    expect((await ws.listWorkspaces(inNew)).map((w) => [w.name, w.home, w.active])).toEqual([["Your workspace", true, false], ["cafeclub", false, true]]);
    await ws.setActiveWorkspace(inNew, home);
    expect(jar.has(ws.ACTIVE_WORKSPACE_COOKIE)).toBe(false);
    const back = (await auth.identity())!;
    expect(back.workspace_id).toBe(home);
    expect((await db.list<{ id: string }>(back.workspace_id, "game")).map((g) => g.id)).toEqual(["game_forever"]);
  });

  it("never opens someone else's workspace, even with a forged cookie", async () => {
    const a = await signIn("a");
    const theirs = await ws.createWorkspace(a, "Private");
    const b = await signIn("b");
    await expect(ws.requireOwnWorkspace(b, theirs)).rejects.toMatchObject({ status: 404 });
    await expect(ws.requireOwnWorkspace(b, a.workspace_id)).rejects.toMatchObject({ status: 404 });
    jar.set(ws.ACTIVE_WORKSPACE_COOKIE, theirs);
    expect((await auth.identity())!.workspace_id).toBe(b.workspace_id);
    jar.set(ws.ACTIVE_WORKSPACE_COOKIE, "ws_not-a-real-id");
    expect((await auth.identity())!.workspace_id).toBe(b.workspace_id);
    expect((await ws.listWorkspaces(b)).map((w) => w.id)).toEqual([b.workspace_id]);
    await expect(ws.renameWorkspace(b, theirs, "Mine now")).rejects.toMatchObject({ status: 404 });
  });

  it("renames, and checks names", async () => {
    const a = await signIn("a");
    await ws.renameWorkspace(a, a.workspace_id, "Forever");
    expect(await ws.activeWorkspaceName(a)).toBe("Forever");
    await expect(ws.createWorkspace(a, "   ")).rejects.toMatchObject({ status: 400 });
    await expect(ws.createWorkspace(a, "x".repeat(61))).rejects.toMatchObject({ status: 400 });
    await expect(ws.createWorkspace(a, "tab\there")).resolves.toMatch(/^ws_/);
  });

  it("caps workspaces per account", async () => {
    const a = await signIn("a");
    for (let i = 1; i < ws.MAX_WORKSPACES; i++) await ws.createWorkspace(a, `W${i}`);
    await expect(ws.createWorkspace(a, "One too many")).rejects.toMatchObject({ status: 409 });
  });

  it("the route creates and switches, and refuses other sites and strangers", async () => {
    const a = await signIn("a");
    expect((await post({ action: "create", name: "cafeclub" }, "https://evil.example")).status).toBe(403);
    const made = await post({ action: "create", name: "cafeclub" });
    expect(made.status).toBe(200);
    const { id } = await made.json();
    expect(jar.get(ws.ACTIVE_WORKSPACE_COOKIE)).toBe(id);
    const list = await (await route.GET()).json();
    expect(list.workspaces.map((w: { name: string; active: boolean }) => [w.name, w.active])).toEqual([["Your workspace", false], ["cafeclub", true]]);
    expect((await post({ action: "switch", id: a.workspace_id })).status).toBe(200);
    expect(jar.has(ws.ACTIVE_WORKSPACE_COOKIE)).toBe(false);
    expect((await post({ action: "switch", id: "ws_00000000000000000000000000000000" })).status).toBe(404);
    expect((await post({ action: "delete", id })).status).toBe(400);
    await signIn("b");
    expect((await post({ action: "switch", id })).status).toBe(404);
  });
});
