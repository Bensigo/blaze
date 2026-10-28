import { publicIPv4, resolvePublicHost } from "../src/lib/network-policy";
export { publicIPv4 };

export async function validateGameUrl(
  input: string,
  allowLocalFixture: boolean,
): Promise<{ url: string; host: string; ip: string; local: boolean }> {
  const u = new URL(input);
  if (!["http:", "https:"].includes(u.protocol) || u.username || u.password)
    throw new Error("Game URL must be HTTP(S) without credentials");
  u.search = "";
  u.hash = "";
  const local = allowLocalFixture &&
    (u.hostname === "localhost" || u.hostname === "127.0.0.1") &&
    u.pathname === "/fixture/index.html";
  if (local) return { url: u.href, host: u.hostname, ip: "127.0.0.1", local: true };
  if (u.protocol !== "https:") throw new Error("Game URL must be public HTTPS");
  const ip = await resolvePublicHost(u.hostname);
  return { url: u.href, host: u.hostname, ip, local: false };
}
