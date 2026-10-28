import { describe, it, expect, vi, afterEach } from "vitest";
import {
  isPublicIPv4,
  fetchPublic,
  pinnedLookup,
} from "../src/lib/integrations/safe-fetch";
import { createServer, request } from "node:http";
import type { AddressInfo } from "node:net";
import {
  draftContent,
  publishPost,
  checkPublication,
  testConnection,
} from "../src/lib/integrations";
import type { Game, Post } from "../src/lib/types";
const game: Game = {
  id: "g",
  title: "Game",
  url: "https://game.example",
  description: "Game",
  image: "",
  genre: "",
  sdkKey: "",
  origins: [],
  createdAt: "",
  dailyEnabled: true,
  competitors: [],
};
const post: Post = {
  id: "p",
  gameId: "g",
  channel: "x",
  text: "Hello",
  accountId: "a",
  status: "approved",
  createdAt: "",
  campaignId: "c",
};
const secret = { token: "secret", accountId: "a", model: "claude-model" };
afterEach(() => vi.unstubAllGlobals());
describe("public URL protection", () => {
  it("pins real HTTP connections under both Node lookup callback modes", async () => {
    const server = createServer((_request, response) =>
      response.end("Pinned fixture"),
    );
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    try {
      for (const options of [{ autoSelectFamily: true }, { family: 4 }]) {
        const body = await new Promise<string>((resolve, reject) => {
          const req = request(
            `http://browser-fixture.invalid:${(server.address() as AddressInfo).port}`,
            { ...options, lookup: pinnedLookup("127.0.0.1") },
            (response) => {
              let text = "";
              response.on("data", (chunk) => {
                text += chunk;
              });
              response.on("end", () => resolve(text));
              response.on("error", reject);
            },
          );
          req.on("error", reject);
          req.end();
        });
        expect(body).toBe("Pinned fixture");
      }
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });
  it("rejects private and reserved IPv4 and IPv6 URLs", async () => {
    for (const a of [
      "127.0.0.1",
      "10.1.2.3",
      "169.254.169.254",
      "100.64.0.1",
      "192.168.1.1",
      "198.18.1.1",
      "203.0.113.1",
    ])
      expect(isPublicIPv4(a)).toBe(false);
    expect(isPublicIPv4("8.8.8.8")).toBe(true);
    await expect(fetchPublic("http://[::1]/")).rejects.toThrow();
    await expect(fetchPublic("http://127.0.0.1/")).rejects.toThrow();
  });
});
describe("provider adapters", () => {
  it("requires a real Anthropic key and returns provider content", async () => {
    await expect(
      draftContent({ game, channel: "x", secret: { token: "" } }),
    ).rejects.toThrow();
    const fetch = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ content: [{ type: "text", text: "A real draft" }] }),
        ),
      );
    vi.stubGlobal("fetch", fetch);
    expect(await draftContent({ game, channel: "x", secret })).toBe(
      "A real draft",
    );
    expect(fetch.mock.calls[0][0]).toBe(
      "https://api.anthropic.com/v1/messages",
    );
  });
  it("requires video bytes for an X clip", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const result = await publishPost({
      post: { ...post, clipId: "c" },
      game,
      secret,
    });
    expect(result.state).toBe("failed");
    expect(fetch).not.toHaveBeenCalled();
  });
  it("marks accepted X requests processing and checks visibility", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { id: "123" } })),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { id: "123" } })),
      );
    vi.stubGlobal("fetch", fetch);
    expect(await publishPost({ post, game, secret })).toMatchObject({
      state: "processing",
      providerId: "123",
    });
    expect(
      await checkPublication({
        post: { ...post, providerId: "123" },
        game,
        secret,
      }),
    ).toMatchObject({
      state: "published",
      publicationUrl: "https://x.com/i/web/status/123",
    });
  });
  it("uploads X video without creating a post, then checks processing", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { id: "55" } })),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: {} })))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ data: { processing_info: { state: "pending" } } }),
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ data: { processing_info: { state: "succeeded" } } }),
        ),
      );
    vi.stubGlobal("fetch", fetch);
    const videoPost = { ...post, clipId: "c" };
    expect(
      await publishPost({
        post: videoPost,
        game,
        secret,
        media: { bytes: new Uint8Array([1, 2]), contentType: "video/mp4" },
      }),
    ).toMatchObject({ state: "processing", providerId: "x-media:55" });
    expect(
      (
        await checkPublication({
          post: { ...videoPost, providerId: "x-media:55" },
          game,
          secret,
        })
      ).error,
    ).toContain("separately reserved");
    expect(
      fetch.mock.calls.every((call) => !String(call[0]).endsWith("/2/tweets")),
    ).toBe(true);
  });
  it("keeps Instagram containers processing until a separately reserved publication", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "55" })))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ status_code: "FINISHED" })),
      );
    vi.stubGlobal("fetch", fetch);
    const ig = { ...post, channel: "instagram" as const, clipId: "c" };
    const uploaded = await publishPost({
      post: ig,
      game,
      secret,
      media: { publicUrl: "https://example.com/signed" },
    });
    expect(uploaded).toMatchObject({
      state: "processing",
      providerId: "ig-container:55",
    });
    expect(
      (
        await checkPublication({
          post: { ...ig, providerId: uploaded.providerId },
          game,
          secret,
        })
      ).error,
    ).toContain("separately reserved");
    expect(
      fetch.mock.calls.every(
        (call) => !String(call[0]).includes("media_publish"),
      ),
    ).toBe(true);
  });
  it("does not retry a request whose write outcome is unknown", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("network failure")),
    );
    expect(await publishPost({ post, game, secret })).toMatchObject({
      state: "processing",
      error: expect.stringContaining("reconcile"),
    });
  });
  it("does not treat YouTube upload as published until processing succeeds and is public", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            items: [
              {
                status: { privacyStatus: "private" },
                processingDetails: { processingStatus: "succeeded" },
              },
            ],
          }),
        ),
      ),
    );
    expect(
      (
        await checkPublication({
          post: { ...post, channel: "youtube", providerId: "123" },
          game,
          secret,
        })
      ).state,
    ).toBe("processing");
  });
  it("blocks TikTok without explicit creator controls before any request", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    expect(
      (
        await publishPost({
          post: { ...post, channel: "tiktok" },
          game,
          secret,
        })
      ).state,
    ).toBe("failed");
    expect(fetch).not.toHaveBeenCalled();
  });
  it("does not claim connected on a rejected account check", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("{}", { status: 401 })),
    );
    expect((await testConnection("x", secret)).connected).toBe(false);
  });
});
