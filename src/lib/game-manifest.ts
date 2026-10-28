import { createHash } from "node:crypto";
import { isPublicFile, validateForeverJson, type PublicGameFile } from "./forever-json-consumer";
import { fetchPublic } from "./integrations/safe-fetch";

export type ManifestFacts = PublicGameFile;
export type ManifestResult =
  | { status: "complete"; facts: ManifestFacts; source: { url: string; observedAt: string; sha256: string; formatVersion: 1 } }
  | { status: "unavailable" | "unsupported" | "invalid"; detail: string }
  | { status: "not_applicable" };

/** Only this application's configured development fixture may use loopback. */
export function isLocalFixture(gameUrl: string, appOrigin?: string): boolean {
  try {
    const game = new URL(gameUrl);
    const configured = new URL(process.env.APP_URL || "");
    return process.env.NODE_ENV === "development" && !process.env.VERCEL && !process.env.SITE_ID &&
      ["http:", "https:"].includes(configured.protocol) && ["localhost", "127.0.0.1"].includes(configured.hostname) &&
      !configured.username && !configured.password && configured.pathname === "/" && !configured.search && !configured.hash &&
      configured.origin === game.origin && appOrigin === game.origin && game.pathname.replace(/\/+$/, "") === "/fixture/index.html" &&
      !game.username && !game.password && !game.search && !game.hash;
  } catch { return false; }
}

/** Append to the supplied game path, including file-like paths, without changing its origin. */
export function foreverManifestUrl(gameUrl: string, appOrigin?: string): string | undefined {
  try {
    const u = new URL(gameUrl);
    if (!["http:", "https:"].includes(u.protocol) || u.username || u.password || u.search || u.hash || (u.port && !["80", "443"].includes(u.port) && !isLocalFixture(gameUrl, appOrigin))) return;
    u.pathname = `${u.pathname.replace(/\/+$/, "")}/forever.json`;
    return u.href;
  } catch { return; }
}

export async function readGameManifest(gameUrl: string, appOrigin?: string): Promise<ManifestResult> {
  const url = foreverManifestUrl(gameUrl, appOrigin);
  if (!url) return { status: "not_applicable" };
  try {
    const localFixture = isLocalFixture(gameUrl, appOrigin);
    let response: { url: string; status: number; body: string };
    if (localFixture) {
      const res = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(8000) });
      const reader = res.body?.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      if (reader) for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 64_000) { await reader.cancel(); return { status: "invalid", detail: "Manifest exceeds the 64 KB reader limit." }; }
        chunks.push(value);
      }
      response = { url: res.url, status: res.status, body: Buffer.concat(chunks).toString("utf8") };
    } else response = await fetchPublic(url, 0);
    if (response.url !== url || response.status < 200 || response.status >= 300)
      return { status: "unavailable", detail: response.status === 404 ? "forever.json was not found at the game URL." : `forever.json is unavailable at the game URL (HTTP ${response.status}).` };
    if (Buffer.byteLength(response.body, "utf8") > 64_000)
      return { status: "invalid", detail: "Manifest exceeds the 64 KB reader limit." };
    let raw: unknown;
    try { raw = JSON.parse(response.body); } catch { return { status: "invalid", detail: "Manifest is not valid JSON." }; }
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { status: "invalid", detail: "Manifest must be an object." };
    if ((raw as {formatVersion?: unknown}).formatVersion !== 1)
      return { status: "unsupported", detail: "Manifest formatVersion is missing or unsupported; this reader supports version 1." };
    const parsed = validateForeverJson(raw);
    if (!parsed.ok) return { status: "invalid", detail: `Invalid forever.json: ${parsed.errors.slice(0, 4).join("; ")}` };
    if (!isPublicFile(parsed.file)) return { status: "invalid", detail: "The manifest describes a hidden game, not a public game page." };
    return { status: "complete", facts: parsed.file, source: { url, observedAt: new Date().toISOString(), sha256: createHash("sha256").update(response.body).digest("hex"), formatVersion: 1 } };
  } catch { return { status: "unavailable", detail: "forever.json could not be fetched safely (the host may be inaccessible, private, or redirecting)." }; }
}
