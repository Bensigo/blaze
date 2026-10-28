import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { chromium, type Browser, type BrowserContext } from "playwright";
import { createServer, type Server } from "node:https";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { normalizeNetworkPolicy, resolvePublicHost, type Resolver } from "../src/lib/network-policy";
import { installAgentMarker, installBrowserPolicy, prepareBrowserPolicy, resolverRules } from "../worker/network-policy";

const publicDNS: Resolver = async () => [{ address: "8.8.8.8", family: 4 }];
describe("network origin validation", () => {
  it("normalizes exact origins and rejects credentials, paths and non-public literals", async () => {
    expect(normalizeNetworkPolicy({ resourceOrigins: ["https://CDN.Example:443/", "https://cdn.example"], webSocketOrigins: ["wss://socket.example/"] })).toEqual({ resourceOrigins: ["https://cdn.example"], webSocketOrigins: ["wss://socket.example"] });
    for (const value of ["https://user@host.test", "https://*.host.test", "https://127.0.0.1", "https://[::1]", "https://host.test/a", "https://host.test/a/..", "https://host.test?", "http://host.test", "https://localhost"]) {
      expect(() => normalizeNetworkPolicy({ resourceOrigins: [value], webSocketOrigins: [] }), value).toThrow();
    }
    await expect(resolvePublicHost("rebind.test", async () => [{ address: "8.8.8.8", family: 4 }, { address: "127.0.0.1", family: 4 }])).rejects.toThrow();
  });
});

describe("real Chromium network enforcement", () => {
  let server: Server, browser: Browser, dir: string, port: number;
  let arrivals: string[] = [];
  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "network-fixture-"));
    execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", join(dir, "key.pem"), "-out", join(dir, "cert.pem"), "-days", "1", "-subj", "/CN=game.test", "-addext", "subjectAltName=DNS:game.test,DNS:cdn.test,DNS:socket.test,DNS:unknown.test,IP:127.0.0.1"], { stdio: "ignore" });
    server = createServer({ key: readFileSync(join(dir, "key.pem")), cert: readFileSync(join(dir, "cert.pem")) }, (req, res) => {
      arrivals.push(`${req.headers.host}${req.url}`);
      if (req.url === "/redirect-collect") { res.writeHead(302, { location: "/api/collect" }); res.end(); return; }
      if (req.url === "/redirect-private") { res.writeHead(302, { location: `https://127.0.0.1:${port}/private` }); res.end(); return; }
      if (req.url === "/redirect-unknown") { res.writeHead(302, { location: `https://unknown.test:${port}/unknown` }); res.end(); return; }
      if (req.url === "/redirect-socket") { res.writeHead(302, { location: `https://socket.test:${port}/socket-resource` }); res.end(); return; }
      res.setHeader("Access-Control-Allow-Origin", "*");
      if (req.url === "/asset") res.end("asset-ok");
      else res.end("<title>controlled game</title>");
    });
    server.on("upgrade", (req, socket) => {
      arrivals.push(`${req.headers.host}${req.url}`);
      const accept = createHash("sha1").update(String(req.headers["sec-websocket-key"]) + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest("base64");
      socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
      socket.write(Buffer.from([0x81, 2, 111, 107]));
      socket.on("error", () => {});
      setTimeout(() => socket.destroy(), 500);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    port = (server.address() as AddressInfo).port;
  });
  afterAll(async () => { await browser?.close(); await new Promise<void>(resolve => server.close(() => resolve())); rmSync(dir, { recursive: true, force: true }); });
  async function run(include: boolean) {
    arrivals = [];
    const game = `https://game.test:${port}`, cdn = `https://cdn.test:${port}`, socket = `wss://socket.test:${port}`;
    let answer = "8.8.8.8", calls = 0;
    const resolver: Resolver = async () => { calls++; return [{ address: answer, family: 4 }]; };
    const policy = await prepareBrowserPolicy({ url: `${game}/`, host: "game.test", ip: "8.8.8.8", local: false }, { resourceOrigins: include ? [cdn] : [], webSocketOrigins: include ? [socket, `wss://game.test:${port}`] : [] }, false, resolver);
    const pins = [...policy.pins.values()]; answer = "127.0.0.1"; // DNS rebinding after resolution cannot change recorded pins.
    // Test transport only: bind the already-validated public names to this local TLS server.
    for (const host of policy.pins.keys()) policy.pins.set(host, "127.0.0.1");
    const args = ["--no-proxy-server", "--disable-quic", "--disable-features=LocalNetworkAccessChecks,LocalNetworkAccessChecksWebSockets", `--host-resolver-rules=${resolverRules(policy)}`];
    browser = await chromium.launch({ headless: true, args });
    const context: BrowserContext = await browser.newContext({ ignoreHTTPSErrors: true, serviceWorkers: "block", acceptDownloads: false });
    await installAgentMarker(context);
    const page = await context.newPage(); let blocked = 0;
    await installBrowserPolicy(context, page, policy, () => blocked++, game);
    await page.goto(game);
    const result = await page.evaluate(async ({ cdn, socket, game, port }) => {
      const fetchIt = async (url: string) => { try { const r = await fetch(url); return await r.text(); } catch { return "blocked"; } };
      const asset = await fetchIt(`${cdn}/asset`);
      const ws = await new Promise<string>((resolve) => { const s = new WebSocket(`${socket}/ws`); const timer = setTimeout(() => { s.close(); resolve("blocked"); }, 2500); s.onmessage = event => { clearTimeout(timer); s.close(); resolve(event.data); }; s.onerror = () => { clearTimeout(timer); resolve("blocked"); }; s.onclose = () => { clearTimeout(timer); resolve("blocked"); }; });
      const marker = (window as unknown as { __WEB_GAME_STUDIO_AGENT__?: boolean }).__WEB_GAME_STUDIO_AGENT__;
      const markerImmutable = Object.getOwnPropertyDescriptor(window, "__WEB_GAME_STUDIO_AGENT__")?.writable === false && Object.getOwnPropertyDescriptor(window, "__WEB_GAME_STUDIO_AGENT__")?.configurable === false;
      const collect = await fetchIt(`${game}/api/collect`);
      const capture = await fetchIt(`${game}/api/capture/start`);
      const encodedCollect = await fetchIt(`${game}/api/%63ollect`);
      const collectRedirect = await fetchIt(`${game}/redirect-collect`);
      const privateRedirect = await fetchIt(`${game}/redirect-private`);
      const unknownRedirect = await fetchIt(`${game}/redirect-unknown`);
      const socketRedirect = await fetchIt(`${game}/redirect-socket`);
      const directPrivate = await fetchIt(`https://127.0.0.1:${port}/private`);
      const unknownSocket = await new Promise<string>((resolve) => { const s = new WebSocket(`wss://unknown.test:${port}/ws`); const timer = setTimeout(() => { s.close(); resolve("blocked"); }, 2500); s.onopen = () => { clearTimeout(timer); s.close(); resolve("open"); }; s.onerror = s.onclose = () => { clearTimeout(timer); resolve("blocked"); }; });
      const imageRedirect = await new Promise<string>((resolve) => { const image = new Image(); const timer = setTimeout(() => resolve("blocked"), 2000); image.onload = () => { clearTimeout(timer); resolve("loaded"); }; image.onerror = () => { clearTimeout(timer); resolve("blocked"); }; image.src = `${game}/redirect-private`; });
      const privateSocket = await new Promise<string>((resolve) => { const s = new WebSocket(`wss://127.0.0.1:${port}/private-ws`); const timer = setTimeout(() => { s.close(); resolve("blocked"); }, 1000); s.onopen = () => { clearTimeout(timer); s.close(); resolve("open"); }; s.onerror = s.onclose = () => { clearTimeout(timer); resolve("blocked"); }; });
      const telemetrySocket = await new Promise<string>((resolve) => { const s = new WebSocket(`wss://game.test:${port}/api/collect`); const timer = setTimeout(() => { s.close(); resolve("blocked"); }, 1000); s.onopen = () => { clearTimeout(timer); s.close(); resolve("open"); }; s.onerror = s.onclose = () => { clearTimeout(timer); resolve("blocked"); }; });
      const sameHostSocket = await new Promise<string>((resolve) => { const s = new WebSocket(`wss://game.test:${port}/same-host-ws`); const timer = setTimeout(() => { s.close(); resolve("blocked"); }, 2500); s.onopen = () => { clearTimeout(timer); s.close(); resolve("open"); }; s.onerror = s.onclose = () => { clearTimeout(timer); resolve("blocked"); }; });
      const worker = await new Promise<string>((resolve) => { const blob = new Blob([`fetch('${game}/worker-hit'); postMessage('opened')`], { type: 'text/javascript' }); const w = new Worker(URL.createObjectURL(blob)); const timer = setTimeout(() => { w.terminate(); resolve('blocked'); }, 1000); w.onmessage = () => { clearTimeout(timer); w.terminate(); resolve('opened'); }; w.onerror = () => { clearTimeout(timer); resolve('blocked'); }; });
      const blankFrame = document.createElement('iframe'); document.body.appendChild(blankFrame);
      const frameMarker = (blankFrame.contentWindow as unknown as { __WEB_GAME_STUDIO_AGENT__?: boolean }).__WEB_GAME_STUDIO_AGENT__;
      const frameSocket = await new Promise<string>((resolve) => { try { const FrameWebSocket = (blankFrame.contentWindow as unknown as typeof window).WebSocket; const s = new FrameWebSocket(`wss://game.test:${port}/api/capture/start`); const timer = setTimeout(() => { s.close(); resolve("blocked"); }, 1000); s.onopen = () => { clearTimeout(timer); s.close(); resolve("open"); }; s.onerror = s.onclose = () => { clearTimeout(timer); resolve("blocked"); }; } catch { resolve("blocked"); } });
      window.open(`${game}/popup-hit`);
      const iframe = document.createElement('iframe'); iframe.src = `${game}/frame-hit`; document.body.appendChild(iframe);
      await new Promise(resolve => setTimeout(resolve, 500));
      return { asset, ws, privateRedirect, unknownRedirect, socketRedirect, directPrivate, unknownSocket, sameHostSocket, worker, frameSocket, imageRedirect, privateSocket, marker, markerImmutable, collect, capture, collectRedirect, encodedCollect, telemetrySocket, frameMarker };
    }, { cdn, socket, game, port });
    await context.close(); await browser.close();
    return { result, arrivals: [...arrivals], blocked, pins, calls };
  }
  it("permits an explicitly configured second resource origin and WSS, but blocks redirect and private escapes", async () => {
    const { result, arrivals, blocked, pins, calls } = await run(true);
    expect(result).toEqual({ asset: "asset-ok", ws: "ok", privateRedirect: "blocked", unknownRedirect: "blocked", socketRedirect: "blocked", directPrivate: "blocked", unknownSocket: "blocked", sameHostSocket: "open", worker: "blocked", frameSocket: "blocked", imageRedirect: "blocked", privateSocket: "blocked", marker: true, markerImmutable: true, collect: "blocked", capture: "blocked", collectRedirect: "blocked", encodedCollect: "blocked", telemetrySocket: "blocked", frameMarker: true });
    expect(arrivals.some(x => /\/(private|unknown|socket-resource|worker-hit|popup-hit|frame-hit|frame-ws|private-ws|api\/collect|api\/capture\/start)$/.test(x))).toBe(false);
    expect(blocked).toBeGreaterThanOrEqual(2);
    expect(pins.every(x => x === "8.8.8.8")).toBe(true);
    expect(calls).toBe(2);
  }, 30000);
  it("blocks the same CDN and socket when not explicitly configured", async () => {
    const { result, arrivals } = await run(false);
    expect(result.asset).toBe("blocked"); expect(result.ws).toBe("blocked"); expect(result.sameHostSocket).toBe("blocked");
    expect(arrivals.some(x => x.includes("/asset") || x.includes("/ws"))).toBe(false);
  }, 30000);
});
