import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("../src/lib/integrations/safe-fetch", () => ({ fetchPublic: vi.fn() }));
import { fetchPublic } from "../src/lib/integrations/safe-fetch";
import { foreverManifestUrl, readGameManifest } from "../src/lib/game-manifest";
import { gameMetadata } from "../src/lib/metadata";
import { validateForeverJson } from "../src/lib/forever-json-consumer";
import fixture from "../src/lib/controlled-fixture-manifest.json";
// Copy of Forever's games/whot/forever.json at b7aafab4.
const sample = JSON.parse(readFileSync(new URL("./fixtures/forever-whot.json", import.meta.url), "utf8"));
const game = "https://example.com/arcade/index.html";
const url = `${game}/forever.json`;
function response(value: unknown, responseUrl = url, status = 200) { vi.mocked(fetchPublic).mockResolvedValueOnce({ status, url: responseUrl, body: typeof value === "string" ? value : JSON.stringify(value), contentType: "application/json", xRobotsTag: "", elapsedMs: 1 }); }
beforeEach(() => vi.resetAllMocks());
describe("Forever manifest reader", () => {
  it("keeps the local acceptance fixture valid under the producer schema", () => { expect(validateForeverJson(fixture)).toMatchObject({ ok: true }); });
  it("appends to arbitrary paths and normalizes trailing slashes", () => {
    expect(foreverManifestUrl(game)).toBe(url);
    expect(foreverManifestUrl("https://example.com/arcade/index.html///")).toBe(url);
    expect(foreverManifestUrl("https://example.com/")).toBe("https://example.com/forever.json");
    expect(foreverManifestUrl("http://example.com/nested/game")).toBe("http://example.com/nested/game/forever.json");
    for (const input of ["https://example.com/game?token=secret", "https://user@example.com/game", "ftp://example.com/game"]) expect(foreverManifestUrl(input)).toBeUndefined();
  });
  it("limits the loopback exception to the configured development fixture", async () => {
    vi.stubEnv("NODE_ENV", "development"); vi.stubEnv("APP_URL", "http://127.0.0.1:3000");
    vi.stubEnv("VERCEL", ""); vi.stubEnv("SITE_ID", "");
    const localUrl = "http://127.0.0.1:3000/fixture/index.html/forever.json";
    const localResponse = new Response(JSON.stringify(fixture), { status: 200 });
    Object.defineProperty(localResponse, "url", { value: localUrl });
    const localFetch = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(localResponse);
    try {
      expect((await readGameManifest("http://127.0.0.1:3000/fixture/index.html", "http://127.0.0.1:3000")).status).toBe("complete");
      expect(localFetch).toHaveBeenCalledWith(localUrl, expect.objectContaining({ redirect: "manual" }));
      vi.mocked(fetchPublic).mockRejectedValue(new Error("private"));
      expect((await readGameManifest("http://127.0.0.1:3000/other", "http://127.0.0.1:3000")).status).toBe("not_applicable");
      vi.stubEnv("VERCEL", "1");
      expect((await readGameManifest("http://127.0.0.1:3000/fixture/index.html", "http://127.0.0.1:3000")).status).toBe("not_applicable");
      expect(localFetch).toHaveBeenCalledTimes(1);
    } finally { localFetch.mockRestore(); vi.unstubAllEnvs(); }
  });
  it("imports the real producer schema and records provenance", async () => {
    response(sample);
    const result = await readGameManifest(game);
    expect(fetchPublic).toHaveBeenCalledWith(url, 0);
    expect(result).toMatchObject({ status: "complete", facts: { id: sample.id, slug: sample.slug }, source: { url, formatVersion: 1, sha256: expect.stringMatching(/^[a-f0-9]{64}$/), observedAt: expect.any(String) } });
    response(sample);
    const metadata = await gameMetadata(game, "http://localhost:3000");
    expect(metadata).toMatchObject({ url: game, title: sample.name, genre: sample.genre, description: sample.description, image: new URL(sample.media.cover.src, url).href, manifestSource: { url } });
    response(sample);
    expect(await gameMetadata(`${game}///`, "http://localhost:3000")).toMatchObject({ url: game, manifestSource: { url } });
  });
  it("fails closed on missing, invalid, unsupported, hidden and redirected manifests", async () => {
    response({}, url, 404); expect((await readGameManifest(game))).toMatchObject({ status: "unavailable", detail: expect.stringContaining("not found") });
    response("<html>not JSON</html>"); expect((await readGameManifest(game)).status).toBe("invalid");
    response({ ...sample, formatVersion: 2 }); expect((await readGameManifest(game)).status).toBe("unsupported");
    response({ ...sample, genre: "Made up" }); expect((await readGameManifest(game))).toMatchObject({ status: "invalid", detail: expect.stringContaining("genre") });
    response({ ...sample, visibility: "hidden" }); expect((await readGameManifest(game)).status).toBe("invalid");
    response(sample, "https://elsewhere.example/forever.json"); expect((await readGameManifest(game)).status).toBe("unavailable");
    response("x".repeat(64001)); expect((await readGameManifest(game)).status).toBe("invalid");
    vi.mocked(fetchPublic).mockRejectedValueOnce(new Error("private address")); await expect(gameMetadata("http://127.0.0.1/game", "http://localhost:3000")).rejects.toThrow(/fetched safely/);
  });
});
