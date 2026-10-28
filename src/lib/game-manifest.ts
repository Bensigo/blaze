import { createHash } from "node:crypto";
import { z } from "zod";
import { fetchPublic } from "./integrations/safe-fetch";

// This is a bounded reader of the fields used by Blaze, not Forever's full validator.
// The source contract is still in development; unsupported versions fail closed.
const text = (max: number) => z.string().trim().min(1).max(max).refine(s => !/[<>]/.test(s));
const file = z.object({
  formatVersion: z.literal(1),
  id: text(100), slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(100),
  name: text(40), genre: text(50), description: text(160),
  about: z.array(text(1200)).min(1).max(4),
  howToPlay: z.array(text(159)).min(3).max(8),
  faq: z.array(z.object({ q: text(99), a: text(299) })).min(3).max(8),
  controls: z.object({ label: text(200) }),
  visibility: z.enum(["listed", "unlisted"]),
});
export type ManifestFacts = z.infer<typeof file>;
export type ManifestResult =
  | { status: "complete"; facts: ManifestFacts; source: { url: string; observedAt: string; sha256: string; formatVersion: 1 } }
  | { status: "unavailable" | "unsupported" | "invalid"; detail: string }
  | { status: "not_applicable" };

/** Only the documented public-game route on the registered origin is eligible; no discovery probes. */
export function foreverManifestUrl(gameUrl: string): string | undefined {
  try {
    const u = new URL(gameUrl);
    if (u.protocol !== "https:" || u.username || u.password || u.search || u.hash || (u.port && u.port !== "443")) return;
    const match = /^\/games\/([a-z0-9]+(?:-[a-z0-9]+)*)\/?$/.exec(u.pathname);
    if (!match || match[1].length > 100) return;
    return `${u.origin}/games/${match[1]}/forever.json`;
  } catch { return; }
}

/** gameUrl must come from the current workspace's registered game record. */
export async function readGameManifest(gameUrl: string): Promise<ManifestResult> {
  const url = foreverManifestUrl(gameUrl);
  if (!url) return { status: "not_applicable" };
  try {
    const response = await fetchPublic(url, 0);
    // No redirects are followed; the registered origin and endpoint must serve the file directly.
    if (response.url !== url || response.status < 200 || response.status >= 300)
      return { status: "unavailable", detail: "The documented Forever manifest endpoint is not available at the expected URL." };
    if (Buffer.byteLength(response.body, "utf8") > 64_000)
      return { status: "invalid", detail: "Manifest exceeds the 64 KB reader limit." };
    let raw: unknown;
    try { raw = JSON.parse(response.body); } catch { return { status: "invalid", detail: "Manifest is not valid JSON." }; }
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { status: "invalid", detail: "Manifest must be an object." };
    if ((raw as {formatVersion?: unknown}).formatVersion !== 1)
      return { status: "unsupported", detail: "Manifest formatVersion is missing or unsupported; this reader supports version 1." };
    const parsed = file.safeParse(raw);
    if (!parsed.success) return { status: "invalid", detail: "Manifest fields required by this reader are missing or invalid." };
    const expectedSlug = new URL(url).pathname.split("/")[2];
    if (parsed.data.slug !== expectedSlug) return { status: "invalid", detail: "Manifest slug does not match the registered game URL." };
    return { status: "complete", facts: parsed.data, source: { url, observedAt: new Date().toISOString(), sha256: createHash("sha256").update(response.body).digest("hex"), formatVersion: 1 } };
  } catch { return { status: "unavailable", detail: "Manifest could not be fetched safely." }; }
}
