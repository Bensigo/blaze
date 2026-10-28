import { createServer } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { chromium, type BrowserServer } from "playwright";
import { publicIPv4 } from "../src/lib/network-policy";
const token = process.env.EGRESS_TOKEN || "";
if (token.length < 32) throw new Error("Missing egress token");
let server: BrowserServer | undefined;
let busy = false, generation = 0;
createServer((req, res) => {
  const got = Buffer.from(req.headers.authorization || ""), expected = Buffer.from(`Bearer ${token}`);
  if (got.length !== expected.length || !timingSafeEqual(got, expected)) { res.writeHead(401).end(); return; }
  if (req.url !== "/browser") { res.writeHead(404).end(); return; }
  if (req.method === "DELETE") { generation++; void (async () => { if (server) await server.close().catch(() => {}); server = undefined; res.writeHead(204).end(); })(); return; }
  if (req.method !== "POST" || busy || server) { res.writeHead(409).end(); return; }
  busy = true; const requestGeneration = ++generation;
  let body = "", ended = false;
  req.on("data", chunk => { body += chunk; if (body.length > 16384) req.destroy(); });
  req.on("aborted", () => { if (generation === requestGeneration) generation++; if (!ended) busy = false; });
  req.on("end", () => { ended = true; void (async () => {
    try {
      const parsed = JSON.parse(body) as { pins: [string, string][] };
      if (!Array.isArray(parsed.pins) || !parsed.pins.length || parsed.pins.length > 61) throw new Error("Invalid pins");
      const rules: string[] = [];
      for (const pair of parsed.pins) {
        if (!Array.isArray(pair) || pair.length !== 2 || typeof pair[0] !== "string" || typeof pair[1] !== "string" ||
            !/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(pair[0]) || !publicIPv4(pair[1])) throw new Error("Invalid pin");
        rules.push(`MAP ${pair[0]} ${pair[1]}`);
      }
      rules.push("MAP * ~NOTFOUND", "EXCLUDE 172.28.22.2");
      const browserEnv = { ...process.env }; delete browserEnv.EGRESS_TOKEN;
      server = await chromium.launchServer({ env: browserEnv, host: "0.0.0.0", port: 3001, headless: true,
        proxy: { server: "http://172.28.22.2:3128", bypass: "<-loopback>" },
        args: ["--disable-quic", "--force-webrtc-ip-handling-policy=disable_non_proxied_udp", `--host-resolver-rules=${rules.join(", ")}`] });
      if (requestGeneration !== generation || res.destroyed) { await server.close(); server = undefined; return; }
      const url = new URL(server.wsEndpoint()); url.hostname = "172.28.22.3";
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ endpoint: url.href }));
    } catch { if (!res.destroyed) res.writeHead(500).end(); } finally { busy = false; }
  })(); });
}).listen(3000, "0.0.0.0");
