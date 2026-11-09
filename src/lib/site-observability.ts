import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { request as httpsRequest } from "node:https";
import { isPublicIPv4, pinnedLookup } from "./integrations/safe-fetch";
import { siteReportSchema, type SiteReport } from "./site-report";

export type SiteStatus = { status: "connected"; report: SiteReport } | { status: "not_configured" | "unavailable"; reason: string };
type Address = { address: string; family: number };
type Options = { env?: NodeJS.ProcessEnv; resolve?: (host: string) => Promise<Address[]>; transport?: (url: URL, address: string, token: string) => Promise<{status: number; body: string}> };

/** Pinned connection: no redirects, proxy, cookies, response decompression or alternate DNS lookup. */
async function requestReport(url: URL, address: string, token: string): Promise<{status:number;body:string}> {
  return new Promise((resolve, reject) => {
    const req = httpsRequest(url, { lookup: pinnedLookup(address), headers: { authorization: `Bearer ${token}`, accept: "application/json" }, timeout: 8000 }, res => {
      const chunks: Buffer[] = []; let size = 0;
      res.on("data", (chunk: Buffer) => { size += chunk.length; if (size > 262144) req.destroy(new Error("Response too large")); else chunks.push(chunk); });
      res.on("end", () => resolve({ status: res.statusCode || 0, body: Buffer.concat(chunks).toString("utf8") }));
      res.on("error", reject);
    });
    const deadline = setTimeout(() => req.destroy(new Error("Deadline exceeded")),8000);
    req.on("close", () => clearTimeout(deadline)); req.on("timeout", () => req.destroy(new Error("Timeout"))); req.on("error", reject); req.end();
  });
}
export async function readSiteObservability(workspace: string, options: Options = {}): Promise<SiteStatus> {
  const env = options.env ?? process.env;
  if (!env.SITE_HEALTH_WORKSPACE_ID || env.SITE_HEALTH_WORKSPACE_ID !== workspace) return {status:"not_configured",reason:"Site health is not connected to this workspace."};
  const token = env.SITE_HEALTH_TOKEN;
  if (!env.SITE_HEALTH_URL || !token || token.length < 32 || token.length > 4096 || /\s/.test(token)) return {status:"not_configured",reason:"Site health requires a server endpoint and token."};
  try {
    const url = new URL(env.SITE_HEALTH_URL);
    const host = url.hostname.replace(/^\[|\]$/g, "");
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || (url.port && url.port !== "443") || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || isIP(host) === 6) throw new Error("Invalid endpoint");
    let addresses: Address[];
    if (isIP(host)) addresses = [{address:host,family:4}];
    else {
      let deadline: ReturnType<typeof setTimeout> | undefined;
      try { addresses = await Promise.race([(options.resolve ?? (h => lookup(h,{all:true,verbatim:true})))(host), new Promise<never>((_,reject) => { deadline = setTimeout(() => reject(new Error("DNS timeout")),8000); })]); }
      finally { if (deadline) clearTimeout(deadline); }
    }
    if (!addresses.length || addresses.some(a => a.family === 4 && !isPublicIPv4(a.address))) throw new Error("Invalid address");
    const selected = addresses.find(a => a.family === 4 && isPublicIPv4(a.address));
    if (!selected) throw new Error("No public IPv4 address");
    const response = await (options.transport ?? requestReport)(url, selected.address, token);
    if (response.status < 200 || response.status >= 300 || Buffer.byteLength(response.body,"utf8") > 262144 || response.body.includes(token)) throw new Error("Invalid response");
    const report = siteReportSchema.parse(JSON.parse(response.body));
    if (JSON.stringify(report).includes(token) || Date.parse(report.window.since) > Date.parse(report.window.until) || Date.parse(report.generatedAt) < Date.now()-15*60_000 || Date.parse(report.generatedAt) > Date.now()+60_000) throw new Error("Invalid report");
    return {status:"connected",report};
  } catch { return {status:"unavailable",reason:"Site health could not be read. Check the endpoint, token, report format and connection."}; }
}
