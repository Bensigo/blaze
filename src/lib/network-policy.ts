import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export type NetworkPolicy = { resourceOrigins: string[]; webSocketOrigins: string[] };
export type Resolver = (hostname: string) => Promise<{ address: string; family: number }[]>;
export const resolveHost: Resolver = (hostname) => lookup(hostname, { all: true, verbatim: true });

/** Only globally routable IPv4; IPv6 is deliberately unsupported. */
export function publicIPv4(ip: string): boolean {
  if (isIP(ip) !== 4) return false;
  const [a, b, c] = ip.split(".").map(Number);
  return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && (b === 168 || b === 0 || (b === 88 && c === 99))) ||
    (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
    (a === 203 && b === 0 && c === 113));
}

function origin(value: unknown, protocol: "https:" | "wss:"): string {
  if (typeof value !== "string" || value !== value.trim() || /[?#*\\]/.test(value))
    throw new Error("Network origins must be exact HTTPS or WSS origins");
  let u: URL;
  try { u = new URL(value); } catch { throw new Error("Invalid network origin"); }
  if (u.protocol !== protocol || u.username || u.password || value.includes("@") ||
      u.pathname !== "/" || u.hostname === "localhost" || u.hostname.endsWith(".localhost") ||
      u.hostname.endsWith(".") || u.hostname.startsWith("[") ||
      !/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(u.hostname) ||
      (isIP(u.hostname) !== 0 && !publicIPv4(u.hostname)))
    throw new Error("Network origins must be public exact origins without credentials or paths");
  // URL normalizes e.g. /foo/.. to /; reject all literal paths other than a final slash.
  if (!/^[a-zA-Z]+:\/\/[^/]+\/?$/.test(value)) throw new Error("Network origin must not include a path");
  return u.origin;
}

export function normalizeNetworkPolicy(value: unknown): NetworkPolicy {
  if (value === undefined || value === null) return { resourceOrigins: [], webSocketOrigins: [] };
  if (typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid network policy");
  const p = value as Record<string, unknown>;
  if (!Array.isArray(p.resourceOrigins) || !Array.isArray(p.webSocketOrigins) ||
      p.resourceOrigins.length > 30 || p.webSocketOrigins.length > 30)
    throw new Error("Network policy requires up to 30 origins per list");
  return {
    resourceOrigins: [...new Set(p.resourceOrigins.map((v) => origin(v, "https:")))],
    webSocketOrigins: [...new Set(p.webSocketOrigins.map((v) => origin(v, "wss:")))],
  };
}

export async function resolvePublicHost(host: string, resolver: Resolver = resolveHost): Promise<string> {
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".") || host.startsWith("["))
    throw new Error("Host must be public IPv4");
  const ipType = isIP(host);
  if (ipType) {
    if (!publicIPv4(host)) throw new Error("Host must be public IPv4");
    return host;
  }
  const addresses = await resolver(host);
  if (!addresses.length || addresses.some((a) => a.family === 4 && !publicIPv4(a.address)))
    throw new Error("Host resolves to a non-public address");
  const ipv4 = addresses.find((a) => a.family === 4 && publicIPv4(a.address));
  if (!ipv4) throw new Error("Host needs a public IPv4 address");
  return ipv4.address;
}

/** Save-time validation. Resolve again for every worker run; do not persist DNS results. */
export async function verifyNetworkPolicy(value: unknown): Promise<NetworkPolicy> {
  const policy = normalizeNetworkPolicy(value);
  const hosts = new Set([...policy.resourceOrigins, ...policy.webSocketOrigins].map((x) => new URL(x).hostname));
  await Promise.all([...hosts].map((host) => resolvePublicHost(host)));
  return policy;
}
