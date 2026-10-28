import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
const ctx = vi.hoisted(() => ({ workspace: "ws-a" }));
vi.mock("../src/lib/auth", async () => { const actual = await vi.importActual<typeof import("../src/lib/auth")>("../src/lib/auth"); return { ...actual, requireIdentity: async () => ({ id: "owner", email: "owner@example.test", name: "Owner", workspace_id: ctx.workspace }) }; });
vi.mock("../src/lib/credentials", async () => { const actual = await vi.importActual<typeof import("../src/lib/credentials")>("../src/lib/credentials"); return { ...actual, secretFor: async () => undefined }; });
vi.mock("../src/lib/media", async () => { const actual = await vi.importActual<typeof import("../src/lib/media")>("../src/lib/media"); return { ...actual, serveMedia: async () => new Response(new Uint8Array([1,2,3]), { headers: { "Content-Type": "video/mp4", "Cache-Control": "private, no-store" } }) }; });
let db: typeof import("../src/lib/db"), actions: typeof import("../src/app/api/actions/route"), exports: typeof import("../src/app/api/posts/[id]/manual-export/route"), download: typeof import("../src/app/api/posts/[id]/manual-export/download/route"), confirm: typeof import("../src/app/api/posts/[id]/manual-confirm/route"), publishing: typeof import("../src/lib/publishing");
beforeAll(async () => {
  delete process.env.DATABASE_URL; delete process.env.VERCEL; process.env.LOCAL_DATABASE_PATH = "memory://";
  db = await import("../src/lib/db"); actions = await import("../src/app/api/actions/route"); exports = await import("../src/app/api/posts/[id]/manual-export/route"); download = await import("../src/app/api/posts/[id]/manual-export/download/route"); confirm = await import("../src/app/api/posts/[id]/manual-confirm/route"); publishing = await import("../src/lib/publishing");
}, 30000);
beforeEach(async () => {
  ctx.workspace = "ws-a"; await db.query("DELETE FROM records"); await db.query("DELETE FROM jobs"); await db.query("DELETE FROM events"); await db.query("DELETE FROM rate_windows");
  await db.put("ws-a", "game", { id: "game-a", title: "Game", url: "https://game.example/", description: "", image: "", genre: "", sdkKey: "key", origins: [], createdAt: "2026-01-01T00:00:00Z", dailyEnabled: true, competitors: [] });
  await db.put("ws-a", "clip", { id: "clip-a", gameId: "game-a", recordingId: "rec-a", title: "Clip", start: 0, end: 10, layout: "portrait", status: "ready", videoUrl: "/api/media/media_a", createdAt: "2026-01-01T00:00:00Z" });
  await db.put("ws-a", "media", { id: "media_a", recordingId: "rec-a", clipId: "clip-a", kind: "clip", contentType: "video/mp4", size: 3, backend: "local", location: "private", createdAt: "2026-01-01T00:00:00Z" });
});
const request = (path: string, body: unknown, origin = "http://localhost:3000") => new Request(`http://localhost:3000${path}`, { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify(body) });
const act = (body: unknown) => actions.POST(request("/api/actions", body));
const params = (id: string) => ({ params: Promise.resolve({ id }) });
async function makeApproved(deliveryMethod: "manual" | "native" = "manual") {
  const created = await act({ action: "create_post", gameId: "game-a", clipId: "clip-a", channel: "tiktok", text: "Actual caption", accountId: "@owner", deliveryMethod, timeZone: "Asia/Dubai", scheduledAt: "2026-01-01T18:00:00.000Z" });
  expect(created.status).toBe(200); const { post } = await created.json();
  expect((await act({ action: "submit_review", id: post.id })).status).toBe(200);
  return post.id as string;
}
describe("manual publication export", () => {
  it("requires an explicit planned time and zone before approval and export", async () => {
    const created = await act({ action: "create_post", gameId: "game-a", clipId: "clip-a", channel: "tiktok", text: "Caption", accountId: "@owner", deliveryMethod: "manual" });
    const { post } = await created.json();
    expect((await act({ action: "submit_review", id: post.id })).status).toBe(200);
    expect((await act({ action: "approve_post", id: post.id })).status).toBe(400);
    expect((await exports.POST(request(`/api/posts/${post.id}/manual-export`, {}), params(post.id))).status).toBe(409);
  });
  it("requires review approval, preserves exact caption and keeps exported separate from user-confirmed publication", async () => {
    const id = await makeApproved();
    expect((await exports.POST(request(`/api/posts/${id}/manual-export`, {}), params(id))).status).toBe(409);
    expect((await act({ action: "approve_post", id })).status).toBe(200);
    const prepared = await exports.POST(request(`/api/posts/${id}/manual-export`, {}), params(id));
    expect(prepared.status).toBe(200); const body = await prepared.json();
    expect(body.caption).toBe("Actual caption"); expect(body.destinationVerified).toBe(false); expect(body.downloadUrl).toBe(`/api/posts/${id}/manual-export/download`);
    expect(body.recommendation.confidence).toBe("low"); expect(body.recommendation.platformReason).toContain("Cold start"); expect(body.recommendation.time).toContain("arbitrary");
    let post = await db.get<import("../src/lib/types").Post>("ws-a", "post", id);
    expect(post?.manualExportedAt).toBeTruthy(); expect(post?.manualPublishedAt).toBeUndefined(); expect(post?.status).toBe("scheduled");
    const file = await download.GET(new Request(`http://localhost:3000${body.downloadUrl}`), params(id));
    expect(file.status).toBe(200); expect(file.headers.get("content-disposition")).toContain("attachment"); expect(file.headers.get("content-type")).toBe("video/mp4"); expect(file.headers.get("cache-control")).toBe("private, no-store");
    const recorded = await confirm.POST(request(`/api/posts/${id}/manual-confirm`, { publishedAt: "2026-01-01T12:00:00.000Z", url: "https://example.test/post/1" }), params(id));
    expect(recorded.status).toBe(200); post = await db.get("ws-a", "post", id);
    expect(post?.manualPublishedAt).toBe("2026-01-01T12:00:00.000Z"); expect(post?.manualConfirmedAt).toBeTruthy(); expect(post?.manualPublishedBy).toBe("owner"); expect(post?.status).toBe("scheduled");
    expect((await confirm.POST(request(`/api/posts/${id}/manual-confirm`, { publishedAt: "2026-01-01T12:00:00.000Z", url: "javascript:alert(1)" }), params(id))).status).toBe(400);
  });
  it("invalidates approval and manual status on edit and denies foreign workspace media", async () => {
    const id = await makeApproved(); await act({ action: "approve_post", id }); await exports.POST(request(`/api/posts/${id}/manual-export`, {}), params(id));
    await confirm.POST(request(`/api/posts/${id}/manual-confirm`, { publishedAt: "2026-01-01T12:00:00.000Z", url: "https://example.test/post/1" }), params(id));
    ctx.workspace = "ws-b";
    expect((await download.GET(new Request(`http://localhost:3000/api/posts/${id}/manual-export/download`), params(id))).status).toBe(404);
    expect((await exports.POST(request(`/api/posts/${id}/manual-export`, {}), params(id))).status).toBe(404);
    ctx.workspace = "ws-a";
    const changed = await act({ action: "update_post", id, gameId: "game-a", clipId: "clip-a", channel: "tiktok", text: "Revised", accountId: "@owner", deliveryMethod: "manual", timeZone: "Asia/Dubai", scheduledAt: "2026-01-01T18:00:00.000Z" });
    expect(changed.status).toBe(200); const { post } = await changed.json(); expect(post.status).toBe("draft"); expect(post.manualExportedAt).toBeUndefined(); expect(post.manualPublishedAt).toBeUndefined(); expect(post.manualPublicationUrl).toBeUndefined(); expect(post.approvedHash).toBeUndefined();
    expect((await download.GET(new Request(`http://localhost:3000/api/posts/${id}/manual-export/download`), params(id))).status).toBe(409);
  });
  it("keeps native account checks and never dispatches a manual item", async () => {
    const native = await makeApproved("native"); expect((await act({ action: "approve_post", id: native })).status).toBe(400);
    const id = await makeApproved(); const approved = await act({ action: "approve_post", id }); const post = (await approved.json()).post;
    expect(publishing.approvalValid({ ...post, accountId: "@different" })).toBe(false);
    expect(publishing.approvalValid({ ...post, deliveryMethod: "native" })).toBe(false);
    expect(publishing.approvalValid({ ...post, timeZone: "Europe/London" })).toBe(false);
    process.env.PUBLISHING_ENABLED = "true";
    await expect(publishing.dispatch("ws-a", id, true)).rejects.toThrow();
    await publishing.duePublications();
    expect((await db.get<import("../src/lib/types").Post>("ws-a", "post", id))?.status).toBe("scheduled");
    delete process.env.PUBLISHING_ENABLED;
  });
  it("does not export a clip whose media belongs to another workspace", async () => {
    const id = await makeApproved(); await act({ action: "approve_post", id });
    const clip = await db.get<import("../src/lib/types").Clip>("ws-a", "clip", "clip-a");
    await db.put("ws-a", "clip", { ...clip!, videoUrl: "/api/media/media_foreign" });
    await db.put("ws-b", "media", { id: "media_foreign", recordingId: "rec-a", clipId: "clip-a", kind: "clip", contentType: "video/mp4", size: 3, backend: "local", location: "private", createdAt: "2026-01-01T00:00:00Z" });
    expect((await exports.POST(request(`/api/posts/${id}/manual-export`, {}), params(id))).status).toBe(404);
  });
});
