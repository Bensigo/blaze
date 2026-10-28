import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

/** Deliberately conservative: reject all non-public IPv4 ranges and all IPv6. */
export function publicIPv4(ip: string): boolean {
  if (isIP(ip) !== 4) return false;
  const [a, b, c] = ip.split(".").map(Number);
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
export async function validateGameUrl(
  input: string,
  allowLocalFixture: boolean,
): Promise<{ url: string; host: string; ip: string; local: boolean }> {
  const u = new URL(input);
  if (!["http:", "https:"].includes(u.protocol) || u.username || u.password)
    throw new Error("Game URL must be HTTP(S) without credentials");
  u.search = "";
  u.hash = "";
  const local =
    allowLocalFixture &&
    (u.hostname === "localhost" || u.hostname === "127.0.0.1") &&
    u.pathname === "/fixture/index.html";
  if (local)
    return { url: u.href, host: u.hostname, ip: "127.0.0.1", local: true };
  if (
    u.protocol !== "https:" ||
    u.hostname === "localhost" ||
    u.hostname.endsWith(".localhost")
  )
    throw new Error("Game URL must be public HTTPS");
  const addresses = await lookup(u.hostname, { all: true, verbatim: true });
  if (
    !addresses.length ||
    addresses.some((a) => a.family === 4 && !publicIPv4(a.address))
  )
    throw new Error("Game host resolves to a non-public address");
  const ip = addresses.find((a) => a.family === 4)?.address;
  if (!ip) throw new Error("Game host needs a public IPv4 address");
  return { url: u.href, host: u.hostname, ip, local: false };
}
