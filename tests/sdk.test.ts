import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { webcrypto } from "node:crypto";

it("orders events emitted in the same millisecond", () => {
  const fixed = Date.now();
  const clock = vi.spyOn(Date, "now").mockReturnValue(fixed);
  try {
    const h = harness();
    h.sdk.init({
      endpoint: "https://marketing.example",
      sdkKey: "key",
      consent: true,
    });
    h.sdk.track("first_action");
    h.sdk.track("round_start");
    const times = h.requests.map((r) => Date.parse(r.events[0].timestamp));
    expect(times).toEqual([fixed, fixed + 1, fixed + 2, fixed + 3]);
  } finally {
    clock.mockRestore();
  }
});

function harness() {
  const requests: any[] = [];
  const handlers: Record<string, Function[]> = {};
  const storage = () => {
    const items = new Map<string, string>();
    return {
      getItem: (key: string) => items.get(key) || null,
      setItem: (key: string, value: string) => items.set(key, value),
      items,
    };
  };
  const localStorage = storage(),
    sessionStorage = storage();
  const document = {
    readyState: "complete",
    referrer: "https://ref.example/a?secret=1",
    addEventListener: (name: string, fn: Function) => {
      (handlers[name] ??= []).push(fn);
    },
  };
  const window: any = {
    crypto: webcrypto,
    localStorage,
    sessionStorage,
    addEventListener: (name: string, fn: Function) => {
      (handlers[name] ??= []).push(fn);
    },
  };
  const fetch = vi.fn((_url: any, options: any) => {
    requests.push(JSON.parse(options.body));
    return Promise.resolve({ ok: true });
  });
  const location = {
    href: "https://game.example/play?token=secret&utm_source=test&utm_campaign=launch#hidden",
  };
  runInNewContext(readFileSync("public/sdk.js", "utf8"), {
    window,
    crypto: webcrypto,
    document,
    location,
    navigator: { userAgent: "Test" },
    innerWidth: 100,
    innerHeight: 100,
    URL,
    fetch,
    Date,
    Math,
    Number,
    Array,
  });
  return {
    sdk: window.GameMarketing,
    requests,
    handlers,
    localStorage,
    sessionStorage,
  };
}
describe("SDK privacy and consent", () => {
  it("sends and stores nothing before consent; strips URLs and ignores synthetic flags", () => {
    const h = harness();
    h.sdk.init({ endpoint: "https://marketing.example", sdkKey: "key" });
    h.sdk.track("round_start", { kind: "agent" });
    expect(h.requests).toHaveLength(0);
    expect(h.localStorage.items.size).toBe(0);
    h.sdk.setConsent(true);
    h.sdk.track("round_start", {
      step: "level 1",
      kind: "agent",
      secret: "no",
      message: "secret error detail",
    });
    expect(h.requests).toHaveLength(3);
    const event = h.requests[2].events[0];
    expect(event.page).toBe("https://game.example/play");
    expect(event.referrer).toBe("https://ref.example/a");
    expect(event.properties).toEqual({ step: "level 1" });
    expect(event.kind).toBeUndefined();
    expect(JSON.stringify(h.requests)).not.toContain("secret");
    h.sdk.disable();
    h.sdk.track("exit");
    expect(h.requests).toHaveLength(3);
  });
  it("keeps pseudonymous IDs stable within the browser session and normalizes pointer samples", () => {
    const h = harness();
    h.sdk.init({
      endpoint: "https://marketing.example",
      sdkKey: "key",
      consent: true,
    });
    h.handlers.pointerdown[0]({ clientX: 50, clientY: 200 });
    expect(h.requests.map((r) => r.events[0].name)).not.toContain(
      "first_action",
    );
    h.sdk.track("first_action");
    const [visit, , pointer, first] = h.requests.map((r) => r.events[0]);
    expect(pointer.properties).toEqual({ x: 0.5, y: 1 });
    expect(first.name).toBe("first_action");
    expect(first.sessionId).toBe(visit.sessionId);
    expect(first.playerId).toBe(visit.playerId);
    h.sdk.track("first_action");
    expect(
      h.requests.filter((r) => r.events[0].name === "first_action"),
    ).toHaveLength(1);
  });
  it("starts a new session after 30 minutes of inactivity", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
      const h = harness();
      h.sdk.init({
        endpoint: "https://marketing.example",
        sdkKey: "key",
        consent: true,
      });
      h.sdk.track("first_action");
      const old = h.requests[0].events[0];
      vi.setSystemTime(new Date("2026-01-01T00:31:00Z"));
      h.sdk.track("first_action");
      const recent = h.requests.slice(-3).map((r) => r.events[0]);
      expect(recent.map((e) => e.name)).toEqual([
        "visit",
        "loaded",
        "first_action",
      ]);
      expect(recent[0].sessionId).not.toBe(old.sessionId);
      expect(recent[0].playerId).toBe(old.playerId);
    } finally {
      vi.useRealTimers();
    }
  });
});
