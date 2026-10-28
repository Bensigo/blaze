import { afterEach, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { internalNetwork } from "../worker/internal-network";

const initialPrefix = process.env.BLAZE_WORKER_NET_PREFIX;
const initialToken = process.env.EGRESS_TOKEN;
afterEach(() => {
  if (initialPrefix === undefined) delete process.env.BLAZE_WORKER_NET_PREFIX; else process.env.BLAZE_WORKER_NET_PREFIX = initialPrefix;
  if (initialToken === undefined) delete process.env.EGRESS_TOKEN; else process.env.EGRESS_TOKEN = initialToken;
  vi.unstubAllGlobals(); vi.doUnmock("node:os"); vi.resetModules();
});

describe("isolated worker network", () => {
  it("preserves the default and derives fixed service addresses", () => {
    expect(internalNetwork(undefined)).toEqual({ prefix: "172.28.22", guard: "172.28.22.2", browser: "172.28.22.3", worker: "172.28.22.4" });
    expect(internalNetwork("172.16.255").browser).toBe("172.16.255.3");
    expect(internalNetwork("172.31.0").guard).toBe("172.31.0.2");
  });
  it.each(["", "172.15.1", "172.32.1", "172.16.256", "172.16.01", "172.16.1.3", "10.0.0", "172.16.1;echo", " 172.16.1"])("rejects invalid prefix %s", prefix => {
    expect(() => internalNetwork(prefix)).toThrow("Invalid BLAZE_WORKER_NET_PREFIX");
  });
  it("fails the browser entrypoint before firewall commands for an invalid or mismatched prefix", () => {
    for (const prefix of ["172.32.1", "172.16.255"]) {
      expect(() => execFileSync("sh", ["worker/egress-browser-entrypoint.sh"], { env: { ...process.env, BLAZE_WORKER_NET_PREFIX: prefix }, stdio: "pipe" })).toThrow();
    }
  });
  it("rejects a mismatched worker address before contacting services", async () => {
    process.env.BLAZE_WORKER_NET_PREFIX = "172.16.200";
    process.env.EGRESS_TOKEN = "x".repeat(32);
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    vi.doMock("node:os", () => ({ networkInterfaces: () => ({ test: [{ family: "IPv4", address: "172.28.22.4" }] }) }));
    const { startIsolatedBrowser } = await import("../worker/egress-client");
    await expect(startIsolatedBrowser({ resources: new Set(), sockets: new Set(), pins: new Map(), fixture: false })).rejects.toThrow("Worker network address does not match");
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("rejects a browser endpoint for another subnet and resets the guard", async () => {
    process.env.BLAZE_WORKER_NET_PREFIX = "172.16.200";
    process.env.EGRESS_TOKEN = "x".repeat(32);
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, options: RequestInit) => {
      calls.push(`${options.method} ${url}`);
      if (url.endsWith("/browser") && options.method === "POST") return new Response(JSON.stringify({ endpoint: `ws://172.28.22.3:3001/${"x".repeat(32)}` }), { status: 200 });
      return new Response(null, { status: 204 });
    }));
    vi.doMock("node:os", () => ({ networkInterfaces: () => ({ test: [{ family: "IPv4", address: "172.16.200.4" }] }) }));
    const { startIsolatedBrowser } = await import("../worker/egress-client");
    await expect(startIsolatedBrowser({ resources: new Set(["https://game.test"]), sockets: new Set(), pins: new Map([["game.test", "8.8.8.8"]]), fixture: false })).rejects.toThrow("Invalid isolated browser endpoint");
    expect(calls).toContain("POST http://172.16.200.2:9090/policy");
    expect(calls).toContain("DELETE http://172.16.200.2:9090/policy");
  });
});
