import { describe, expect, it, vi } from "vitest";
vi.mock("../src/lib/integrations/safe-fetch", () => ({ fetchPublic: vi.fn() }));
import { fetchPublic } from "../src/lib/integrations/safe-fetch";
import { foreverManifestUrl, readGameManifest } from "../src/lib/game-manifest";
const url = "https://forever.africa/games/whot/forever.json";
const sample = { formatVersion: 1, id: "last-card", slug: "whot", name: "WHOT", genre: "Cards", description: "A card game", about: ["Match cards."], howToPlay: ["Deal.", "Match.", "Win."], faq: [{ q: "Free?", a: "Yes." }, { q: "Phone?", a: "Yes." }, { q: "Friends?", a: "Yes." }], controls: { label: "Mouse or touch" }, visibility: "listed" };
function response(value: unknown, responseUrl = url) { vi.mocked(fetchPublic).mockResolvedValueOnce({ status: 200, url: responseUrl, body: JSON.stringify(value), contentType: "application/json", xRobotsTag: "", elapsedMs: 1 }); }
describe("Forever manifest reader", () => {
  it("only maps the registered exact game route on the registered HTTPS origin", () => {
    expect(foreverManifestUrl("https://forever.africa/games/whot")).toBe(url);
    expect(foreverManifestUrl("https://forever.138-68-247-33.sslip.io/games/whot")).toBe("https://forever.138-68-247-33.sslip.io/games/whot/forever.json");
    expect(foreverManifestUrl("https://example.com/games/whot")).toBe("https://example.com/games/whot/forever.json");
    for (const input of ["http://forever.africa/games/whot", "https://forever.africa/games/whot?token=secret", "https://forever.africa/games/../whot", "https://forever.africa/games/whot/extra"]) expect(foreverManifestUrl(input)).toBeUndefined();
  });
  it("preserves source identity and accepts distinct internal ID and slug", async () => {
    response(sample);
    const result = await readGameManifest("https://forever.africa/games/whot");
    expect(fetchPublic).toHaveBeenCalledWith(url, 0);
    expect(result).toMatchObject({ status: "complete", facts: { id: "last-card", slug: "whot" }, source: { url, formatVersion: 1, sha256: expect.stringMatching(/^[a-f0-9]{64}$/), observedAt: expect.any(String) } });
  });
  it("rejects unsupported versions, identity mismatches and changed redirect targets", async () => {
    response({ ...sample, formatVersion: 2 }); expect((await readGameManifest("https://forever.africa/games/whot")).status).toBe("unsupported");
    response({ ...sample, slug: "other" }); expect((await readGameManifest("https://forever.africa/games/whot")).status).toBe("invalid");
    response(sample, "https://example.com/forever.json"); expect((await readGameManifest("https://forever.africa/games/whot")).status).toBe("unavailable");
  });
});
