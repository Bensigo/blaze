import { networkInterfaces } from "node:os";
import type { BrowserPolicy } from "./network-policy";

import { internalNetwork } from "./internal-network";

const network = internalNetwork(process.env.BLAZE_WORKER_NET_PREFIX);
const guardURL = `http://${network.guard}:9090/policy`;
const browserURL = `http://${network.browser}:3000/browser`;
function credentials(): Record<string, string> {
  const token = process.env.EGRESS_TOKEN || "";
  if (token.length < 32) throw new Error("Isolated browser egress is required for game recordings");
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}
async function call(url: string, method: string, body?: unknown): Promise<Response> {
  const response = await fetch(url, { method, headers: credentials(), body: body ? JSON.stringify(body) : undefined, redirect: "error", signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error("Isolated browser egress unavailable");
  return response;
}
export async function startIsolatedBrowser(policy: BrowserPolicy): Promise<string> {
  credentials();
  if (!Object.values(networkInterfaces()).flat().some(address => address?.family === "IPv4" && address.address === network.worker)) throw new Error("Worker network address does not match BLAZE_WORKER_NET_PREFIX");
  const entries = [...new Set([...policy.resources, ...policy.sockets])].map(origin => {
    const ip = policy.pins.get(new URL(origin).hostname);
    if (!ip) throw new Error("Destination pin missing");
    return { origin, ip };
  });
  await call(guardURL, "POST", { entries });
  try {
    const response = await call(browserURL, "POST", { pins: [...policy.pins] });
    const data = await response.json() as { endpoint?: string };
    const endpoint = new URL(data.endpoint || "");
    if (endpoint.protocol !== "ws:" || endpoint.hostname !== network.browser || endpoint.port !== "3001" || endpoint.username || endpoint.password || endpoint.pathname.length < 25 || endpoint.search || endpoint.hash) throw new Error("Invalid isolated browser endpoint");
    return endpoint.href;
  } catch (error) { await stopIsolatedBrowser(); throw error; }
}
export async function stopIsolatedBrowser(): Promise<void> {
  await Promise.allSettled([call(browserURL, "DELETE"), call(guardURL, "DELETE")]);
}
