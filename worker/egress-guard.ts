import { createServer, type Server } from "node:http";
import { connect, type Socket } from "node:net";
import type { Duplex } from "node:stream";
import { timingSafeEqual } from "node:crypto";
import { publicIPv4, resolvePublicHost, type Resolver } from "../src/lib/network-policy";

type Entry = { origin: string; ip: string };
type Options = { token: string; resolver?: Resolver; dial?: (ip: string, port: number) => Socket };

/** CONNECT-only egress. `dial` and `resolver` are injectable for loopback tests only. */
export function createEgressGuard(options: Options): { proxy: Server; control: Server; stop: () => void } {
  if (options.token.length < 32) throw new Error("Egress guard token must contain at least 32 characters");
  let allowed = new Map<string, string>(), expiresAt = 0, generation = 0;
  const sockets = new Set<Duplex>();
  let expiry: ReturnType<typeof setTimeout> | undefined;
  function stop() {
    generation++; clearTimeout(expiry); expiresAt = 0; allowed.clear();
    for (const socket of sockets) socket.destroy();
    sockets.clear();
  }
  const auth = (value: string | undefined) => {
    const supplied = Buffer.from(value || ""); const expected = Buffer.from(`Bearer ${options.token}`);
    return supplied.length === expected.length && timingSafeEqual(supplied, expected);
  };
  const control = createServer((req, res) => {
    if (!auth(req.headers.authorization)) { res.writeHead(401).end(); return; }
    if (req.method === "DELETE" && req.url === "/policy") { stop(); res.writeHead(204).end(); return; }
    if (req.method !== "POST" || req.url !== "/policy") { res.writeHead(404).end(); return; }
    stop(); const requestGeneration = generation;
    let body = "";
    req.on("data", chunk => { body += chunk; if (body.length > 16384) req.destroy(); });
    req.on("end", () => { void (async () => {
      try {
        const data = JSON.parse(body) as { entries: Entry[] };
        if (!Array.isArray(data.entries) || !data.entries.length || data.entries.length > 61) throw new Error("Invalid entries");
        const next = new Map<string, string>();
        for (const entry of data.entries) {
          const u = new URL(entry.origin);
          if (!(["https:", "wss:"].includes(u.protocol)) || u.username || u.password || u.origin !== entry.origin || u.pathname !== "/" || u.search || u.hash || !publicIPv4(entry.ip)) throw new Error("Invalid destination");
          const resolved = await resolvePublicHost(u.hostname, options.resolver);
          if (resolved !== entry.ip) throw new Error("DNS changed before guard pinning");
          const authority = `${u.hostname}:${u.port || "443"}`;
          const current = next.get(authority);
          if (current && current !== entry.ip) throw new Error("Conflicting host pins");
          next.set(authority, entry.ip);
        }
        if (generation !== requestGeneration || res.destroyed) return;
        allowed = next; expiresAt = Date.now() + 180_000;
        expiry = setTimeout(stop, 180_000); expiry.unref();
        res.writeHead(200, { "content-type": "application/json" }).end('{"ok":true}');
      } catch { if (generation === requestGeneration) stop(); if (!res.destroyed) res.writeHead(400).end(); }
    })(); });
  });
  const proxy = createServer((_req, res) => { res.writeHead(403).end(); });
  proxy.on("connect", (req, client, head) => {
    const authority = req.url || "";
    const match = /^([a-z0-9.-]+):([0-9]{1,5})$/i.exec(authority);
    const port = match ? Number(match[2]) : 0;
    const key = match ? `${match[1].toLowerCase()}:${port}` : "";
    const ip = allowed.get(key);
    if (!ip || !port || port > 65535 || Date.now() >= expiresAt) { client.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n"); return; }
    const upstream = (options.dial || ((address, p) => connect(p, address)))(ip, port);
    sockets.add(client); sockets.add(upstream);
    const close = () => { sockets.delete(client); sockets.delete(upstream); client.destroy(); upstream.destroy(); };
    client.on("error", close); upstream.on("error", close);
    client.on("close", close); upstream.on("close", close);
    upstream.once("connect", () => {
      client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      if (head.length) upstream.write(head);
      upstream.pipe(client); client.pipe(upstream);
    });
  });
  return { proxy, control, stop };
}
