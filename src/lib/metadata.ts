import { createHash } from "node:crypto";
import { load } from "cheerio";
import { isLocalFixture, readGameManifest } from "./game-manifest";
import { fetchPublic } from "./integrations/safe-fetch";
import { HttpError } from "./http-error";
export function imageUrl(value: string, base: string) {
  if (!value) return "";
  try {
    const u = new URL(value, base);
    if (u.username || u.password || !["https:", "http:"].includes(u.protocol)) return "";
    return u.href.slice(0, 2000);
  } catch { return ""; }
}
export type GameMetadata = { url: string; title: string; description: string; image: string; genre: string; metadataStatus: string; manifestSource?: { url: string; observedAt: string; sha256: string; formatVersion: 1 }; pageSource?: { url: string; observedAt: string; sha256: string } };
export async function gameMetadata(input: string, appOrigin: string): Promise<GameMetadata> {
  let url: URL;
  try { url = new URL(input); } catch { throw new HttpError(400, "Enter the full game URL."); }
  url.pathname = url.pathname.replace(/\/+$/, "") || "/";
  if (url.username || url.password || !["http:", "https:"].includes(url.protocol) || url.search || url.hash || (url.port && !["80", "443"].includes(url.port) && !isLocalFixture(url.href, appOrigin)))
    throw new HttpError(400, "Use a public HTTP or HTTPS game URL without credentials, query or fragment.");
  const manifest = await readGameManifest(url.href, appOrigin);
  if (manifest.status === "complete") {
    const image = imageUrl(manifest.facts.media.cover.src, manifest.source.url);
    if (!image) throw new HttpError(400, "Manifest cover.src must resolve to an HTTP or HTTPS URL.");
    return { url: url.href, title: manifest.facts.name, description: manifest.facts.description, image, genre: manifest.facts.genre, metadataStatus: url.origin === appOrigin && url.pathname === "/fixture/index.html" ? "Controlled fixture manifest" : "Forever manifest", manifestSource: manifest.source, pageSource: undefined };
  }
  try {
    // Redirects are intentionally rejected; all network access uses validated, pinned DNS.
    const response = await fetchPublic(url.href, 0);
    if (response.status < 200 || response.status >= 300 || !/^text\/html(?:\s*;|$)/i.test(response.contentType)) throw new Error("Not an HTML page");
    const $ = load(response.body);
    const title = ($('meta[property="og:title"]').attr('content') || $('title').first().text() || '').trim().slice(0, 120);
    if (!title) throw new Error("Page title unavailable");
    const description = ($('meta[property="og:description"]').attr('content') || $('meta[name="description"]').attr('content') || '').trim().slice(0, 500);
    const image = imageUrl($('meta[property="og:image"]').attr('content') || '', response.url);
    return { url: response.url, title, description, image, genre: '', metadataStatus: 'Public page metadata', manifestSource: undefined, pageSource: { url: response.url, observedAt: new Date().toISOString(), sha256: createHash('sha256').update(response.body).digest('hex') } };
  } catch { throw new HttpError(400, "The public game page could not be fetched safely or has no title."); }
}
