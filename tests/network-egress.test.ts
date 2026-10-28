import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer, type Server } from "node:https";
import { request } from "node:http";
import { connect, type AddressInfo } from "node:net";
import { connect as tlsConnect } from "node:tls";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createEgressGuard } from "../worker/egress-guard";
import { startIsolatedBrowser } from "../worker/egress-client";
import type { Resolver } from "../src/lib/network-policy";

const token = "abcdefghijklmnopqrstuvwxyz0123456789";
describe("egress guard network traffic", () => {
  let target: Server, proxyPort: number, adminPort: number, targetPort: number, dir: string;
  let dnsAnswer = "8.8.8.8", dials: string[] = [];
  const resolver: Resolver = async () => [{ address: dnsAnswer, family: 4 }];
  const guard = createEgressGuard({ token, resolver, dial: (ip, port) => { dials.push(`${ip}:${port}`); return connect(targetPort, "127.0.0.1"); } });
  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "egress-test-"));
    execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", join(dir, "key"), "-out", join(dir, "crt"), "-days", "1", "-subj", "/CN=game.test"], { stdio: "ignore" });
    target = createServer({ key: readFileSync(join(dir, "key")), cert: readFileSync(join(dir, "crt")) }, (_req, res) => res.end("https-ok"));
    target.on("upgrade", (req, socket) => {
      const accept = createHash("sha1").update(String(req.headers["sec-websocket-key"]) + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest("base64");
      socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`); socket.end();
    });
    await new Promise<void>(r => target.listen(0, "127.0.0.1", r)); targetPort = (target.address() as AddressInfo).port;
    await new Promise<void>(r => guard.proxy.listen(0, "127.0.0.1", r)); proxyPort = (guard.proxy.address() as AddressInfo).port;
    await new Promise<void>(r => guard.control.listen(0, "127.0.0.1", r)); adminPort = (guard.control.address() as AddressInfo).port;
  });
  afterAll(async () => {
    guard.stop();
    await Promise.all([new Promise<void>(r => guard.proxy.close(() => r())), new Promise<void>(r => guard.control.close(() => r())), new Promise<void>(r => target.close(() => r()))]);
    rmSync(dir, { recursive: true, force: true });
  });
  async function configure(entries: unknown, auth = token) {
    return fetch(`http://127.0.0.1:${adminPort}/policy`, { method: "POST", headers: { Authorization: `Bearer ${auth}`, "Content-Type": "application/json" }, body: JSON.stringify({ entries }) });
  }
  async function tunnel(authority: string, upgrade = false): Promise<string> {
    return new Promise((resolve, reject) => {
      const req = request({ host: "127.0.0.1", port: proxyPort, method: "CONNECT", path: authority });
      req.on("error", reject);
      req.on("connect", (res, socket, head) => {
        if (res.statusCode !== 200) { socket.destroy(); resolve(String(res.statusCode)); return; }
        if (head.length) socket.unshift(head);
        const tls = tlsConnect({ socket, servername: "game.test", rejectUnauthorized: false }, () => {
          tls.write(upgrade ? "GET /socket HTTP/1.1\r\nHost: game.test\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n" : "GET /asset HTTP/1.1\r\nHost: game.test\r\nConnection: close\r\n\r\n");
        });
        let data = ""; tls.on("data", chunk => data += chunk.toString()); tls.on("end", () => resolve(data)); tls.on("error", reject);
      }); req.end();
    });
  }
  it("proxies real HTTPS and WebSocket handshakes only to pinned permitted endpoints", async () => {
    expect((await configure([{ origin: `https://game.test:${targetPort}`, ip: "8.8.8.8" }, { origin: `wss://socket.test:${targetPort}`, ip: "8.8.8.8" }])).status).toBe(200);
    dnsAnswer = "127.0.0.1"; dials = [];
    expect(await tunnel(`game.test:${targetPort}`)).toContain("https-ok");
    expect(await tunnel(`socket.test:${targetPort}`, true)).toContain("101 Switching Protocols");
    expect(dials).toEqual([`8.8.8.8:${targetPort}`, `8.8.8.8:${targetPort}`]);
    expect(await tunnel(`unknown.test:${targetPort}`)).toBe("403");
    expect(await tunnel(`127.0.0.1:${targetPort}`)).toBe("403");
    expect(await tunnel(`game.test:${targetPort + 1}`)).toBe("403");
    expect((await configure([{ origin: `https://game.test:${targetPort}`, ip: "8.8.8.8" }])).status).toBe(400);
    expect(await tunnel(`game.test:${targetPort}`)).toBe("403");
  });
  it("rejects missing auth, private addresses and non-origin inputs", async () => {
    dnsAnswer = "8.8.8.8";
    expect((await configure([{ origin: `https://game.test:${targetPort}`, ip: "8.8.8.8" }], "bad")).status).toBe(401);
    for (const item of [
      { origin: `https://127.0.0.1:${targetPort}`, ip: "127.0.0.1" },
      { origin: `https://game.test:${targetPort}/path`, ip: "8.8.8.8" },
      { origin: `http://game.test:${targetPort}`, ip: "8.8.8.8" },
      { origin: `https://game.test:${targetPort}`, ip: "127.0.0.1" },
    ]) expect((await configure([item])).status).toBe(400);
    expect(await tunnel(`game.test:${targetPort}`)).toBe("403");
  });
});


it("fails closed before launching a non-fixture browser without the guard credential", async () => {
  const previous = process.env.EGRESS_TOKEN;
  delete process.env.EGRESS_TOKEN;
  try {
    await expect(startIsolatedBrowser({ resources: new Set(["https://game.test"]), sockets: new Set(), pins: new Map([["game.test", "8.8.8.8"]]), fixture: false })).rejects.toThrow("Isolated browser egress is required");
  } finally {
    if (previous === undefined) delete process.env.EGRESS_TOKEN; else process.env.EGRESS_TOKEN = previous;
  }
});
