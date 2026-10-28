import { isLocalFixture, readGameManifest } from "./game-manifest";
import { HttpError } from "./http-error";
export function imageUrl(value: string, base: string) {
  if (!value) return "";
  try {
    const u = new URL(value, base);
    if (u.username || u.password || !["https:", "http:"].includes(u.protocol)) return "";
    return u.href.slice(0, 2000);
  } catch { return ""; }
}
export async function gameMetadata(input: string, appOrigin: string) {
  let url: URL;
  try { url = new URL(input); } catch { throw new HttpError(400, "Enter the full game URL."); }
  url.pathname = url.pathname.replace(/\/+$/, "") || "/";
  if (url.username || url.password || !["http:", "https:"].includes(url.protocol) || url.search || url.hash || (url.port && !["80", "443"].includes(url.port) && !isLocalFixture(url.href, appOrigin)))
    throw new HttpError(400, "Use a public HTTP or HTTPS game URL without credentials, query or fragment.");
  const manifest = await readGameManifest(url.href, appOrigin);
  if (manifest.status !== "complete")
    throw new HttpError(400, manifest.status === "not_applicable" ? "Use a valid public game URL." : manifest.detail);
  const image = imageUrl(manifest.facts.media.cover.src, manifest.source.url);
  if (!image) throw new HttpError(400, "Manifest cover.src must resolve to an HTTP or HTTPS URL.");
  return { url: url.href, title: manifest.facts.name, description: manifest.facts.description, image, genre: manifest.facts.genre, metadataStatus: url.origin === appOrigin && url.pathname === "/fixture/index.html" ? "Controlled fixture manifest" : "Forever manifest", manifestSource: manifest.source };
}
