import type { BrowserPolicy } from "./network-policy";

const guardURL = "http://172.28.22.2:9090/policy";
const browserURL = "http://172.28.22.3:3000/browser";
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
    if (endpoint.protocol !== "ws:" || endpoint.hostname !== "172.28.22.3" || endpoint.port !== "3001" || endpoint.username || endpoint.password || endpoint.pathname.length < 25 || endpoint.search || endpoint.hash) throw new Error("Invalid isolated browser endpoint");
    return endpoint.href;
  } catch (error) { await stopIsolatedBrowser(); throw error; }
}
export async function stopIsolatedBrowser(): Promise<void> {
  await Promise.allSettled([call(browserURL, "DELETE"), call(guardURL, "DELETE")]);
}
