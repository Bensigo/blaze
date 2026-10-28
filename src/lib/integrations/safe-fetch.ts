import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import type { LookupFunction } from "node:net";
import type { LookupAddress } from "node:dns";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";

export function pinnedLookup(address: string): LookupFunction {
  return (_host, options, callback) => {
    // Node 20+ can request all addresses for family selection; preserve the
    // validated IPv4 pin while honoring both callback result contracts.
    const all = (options as { all?: boolean }).all;
    const respond = callback as (
      error: NodeJS.ErrnoException | null,
      result: string | LookupAddress[],
      family?: number,
    ) => void;
    respond(
      null,
      all ? [{ address, family: 4 }] : address,
      all ? undefined : 4,
    );
  };
}

// Deliberately IPv4-only: IPv6 transition and mapped ranges require a separate policy.
export function isPublicIPv4(address: string): boolean {
  if (isIP(address) !== 4) return false;
  const [a, b, c] = address.split(".").map(Number);
  return !(
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && (b === 168 || b === 0 || (b === 88 && c === 99))) ||
    (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
    (a === 203 && b === 0 && c === 113)
  );
}
export type PublicResponse = {
  status: number;
  url: string;
  body: string;
  contentType: string;
  xRobotsTag: string;
  elapsedMs: number;
};
export async function fetchPublic(
  input: string,
  redirects = 3,
): Promise<PublicResponse> {
  const start = Date.now();
  const url = new URL(input);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    (url.port && !["80", "443"].includes(url.port))
  )
    throw new Error("Only public HTTP(S) URLs on standard ports are allowed");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    isIP(host) === 6
  )
    throw new Error("Private or unsupported address");
  const addresses = isIP(host)
    ? [{ address: host, family: 4 }]
    : await Promise.race([
        lookup(host, { all: true, verbatim: true }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("DNS lookup timed out")), 8000),
        ),
      ]);
  // Reject mixed public/private DNS results rather than silently picking a public one.
  if (
    !addresses.length ||
    addresses.some((x) => x.family === 4 && !isPublicIPv4(x.address))
  )
    throw new Error("Private or invalid address");
  const selected = addresses.find(
    (x) => x.family === 4 && isPublicIPv4(x.address),
  );
  if (!selected) throw new Error("No supported public IPv4 address");
  const response = await new Promise<{
    status: number;
    location?: string;
    body: string;
    contentType: string;
    xRobotsTag: string;
  }>((resolve, reject) => {
    const req = (url.protocol === "https:" ? httpsRequest : httpRequest)(
      url,
      {
        headers: {
          "User-Agent": "WebGameMarketingResearch/1.0",
          Accept: "text/html,text/plain,application/xml;q=0.9,*/*;q=0.1",
        },
        lookup: pinnedLookup(selected.address),
        timeout: 8000,
      },
      (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > 512_000) req.destroy(new Error("Response exceeds limit"));
          else chunks.push(chunk);
        });
        res.on("end", () =>
          resolve({
            status: res.statusCode || 0,
            location: res.headers.location,
            body: Buffer.concat(chunks).toString("utf8"),
            contentType: String(res.headers["content-type"] || ""),
            xRobotsTag: String(res.headers["x-robots-tag"] || "").slice(0, 500),
          }),
        );
        res.on("error", reject);
      },
    );
    const deadline = setTimeout(
      () => req.destroy(new Error("Request deadline exceeded")),
      8000,
    );
    req.on("close", () => clearTimeout(deadline));
    req.on("timeout", () => req.destroy(new Error("Request timed out")));
    req.on("error", reject);
    req.end();
  });
  if ([301, 302, 303, 307, 308].includes(response.status)) {
    if (!response.location || redirects <= 0)
      throw new Error("Redirect limit reached");
    const next = await fetchPublic(
      new URL(response.location, url).href,
      redirects - 1,
    );
    return { ...next, elapsedMs: Date.now() - start };
  }
  return { ...response, url: url.href, elapsedMs: Date.now() - start };
}
