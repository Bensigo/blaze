import { it, expect } from "vitest";
import { chromium } from "playwright";
import { createServer } from "node:https";
import { connect, type AddressInfo } from "node:net";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createEgressGuard } from "../worker/egress-guard";
import { installBrowserPolicy, prepareBrowserPolicy } from "../worker/network-policy";

it("remote Playwright records a game using the validating proxy, CDN and WSS", async () => {
  const dir = mkdtempSync(join(tmpdir(), "remote-game-test-"));
  const token = "abcdefghijklmnopqrstuvwxyz0123456789";
  execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", join(dir, "key"), "-out", join(dir, "crt"), "-days", "1", "-subj", "/CN=game.test", "-addext", "subjectAltName=DNS:game.test,DNS:cdn.test,DNS:socket.test"], { stdio: "ignore" });
  const site = createServer({ key: readFileSync(join(dir, "key")), cert: readFileSync(join(dir, "crt")) }, (req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    if (req.url === "/asset") res.end("asset-ok"); else res.end("<html><body>remote controlled game</body></html>");
  });
  site.on("upgrade", (req, socket) => {
    const accept = createHash("sha1").update(String(req.headers["sec-websocket-key"]) + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest("base64");
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`); socket.write(Buffer.from([0x81, 2, 111, 107])); socket.on("error", () => {}); setTimeout(() => socket.destroy(), 500);
  });
  await new Promise<void>(r => site.listen(0, "127.0.0.1", r));
  const port = (site.address() as AddressInfo).port;
  const guard = createEgressGuard({ token, resolver: async () => [{ address: "8.8.8.8", family: 4 }], dial: () => connect(port, "127.0.0.1") });
  await new Promise<void>(r => guard.proxy.listen(0, "127.0.0.1", r));
  await new Promise<void>(r => guard.control.listen(0, "127.0.0.1", r));
  const guardPort = (guard.proxy.address() as AddressInfo).port, adminPort = (guard.control.address() as AddressInfo).port;
  const game = `https://game.test:${port}`, cdn = `https://cdn.test:${port}`, socket = `wss://socket.test:${port}`;
  const entries = [game, cdn, socket].map(origin => ({ origin, ip: "8.8.8.8" }));
  const configure = await fetch(`http://127.0.0.1:${adminPort}/policy`, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify({ entries }) });
  expect(configure.status).toBe(200);
  const policy = await prepareBrowserPolicy({ url: `${game}/`, host: "game.test", ip: "8.8.8.8", local: false }, { resourceOrigins: [cdn], webSocketOrigins: [socket] }, false, async () => [{ address: "8.8.8.8", family: 4 }]);
  // Test-only certificate exception, local-network switch, and proxy transport remap.
  const server = await chromium.launchServer({ headless: true, proxy: { server: `http://127.0.0.1:${guardPort}`, bypass: "<-loopback>" }, args: ["--disable-quic", "--force-webrtc-ip-handling-policy=disable_non_proxied_udp", "--host-resolver-rules=MAP game.test 8.8.8.8, MAP cdn.test 8.8.8.8, MAP socket.test 8.8.8.8, MAP * ~NOTFOUND, EXCLUDE 127.0.0.1", "--disable-features=LocalNetworkAccessChecks,LocalNetworkAccessChecksWebSockets"] });
  const browser = await chromium.connect(server.wsEndpoint());
  try {
    const context = await browser.newContext({ ignoreHTTPSErrors: true, serviceWorkers: "block", acceptDownloads: false, recordVideo: { dir, size: { width: 960, height: 540 } }, viewport: { width: 960, height: 540 } });
    const page = await context.newPage(); await installBrowserPolicy(context, page, policy, () => {});
    await page.goto(game);
    const result = await page.evaluate(async ({ cdn, socket }) => {
      const asset = await (await fetch(`${cdn}/asset`)).text();
      const message = await new Promise<string>((resolve, reject) => { const ws = new WebSocket(`${socket}/ws`); const t = setTimeout(() => reject(new Error("socket timeout")), 5000); ws.onmessage = e => { clearTimeout(t); ws.close(); resolve(e.data); }; ws.onerror = () => reject(new Error("socket failure")); });
      return { asset, message };
    }, { cdn, socket });
    expect(result).toEqual({ asset: "asset-ok", message: "ok" });
    await page.waitForTimeout(500);
    const video = page.video(); expect(video).not.toBeNull();
    await context.close();
    const output = join(dir, "remote-saved.webm"); await video!.saveAs(output);
    expect(statSync(output).size).toBeGreaterThan(500);
  } finally {
    await browser.close().catch(() => {}); await server.close().catch(() => {}); guard.stop();
    await Promise.all([new Promise<void>(r => guard.proxy.close(() => r())), new Promise<void>(r => guard.control.close(() => r())), new Promise<void>(r => site.close(() => r()))]);
    rmSync(dir, { recursive: true, force: true });
  }
}, 30000);
