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
    expect(times).toEqual([fixed, fixed + 1, fixed + 2, fixed + 3, fixed + 4]);
  } finally {
    clock.mockRestore();
  }
});

function harness(agent = false) {
  const requests: any[] = [];
  const handlers: Record<string, Function[]> = {};
  const timers = new Map<number, Function>(); let timerId = 0;
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
    hidden: false,
    readyState: "complete",
    referrer: "https://ref.example/a?secret=1",
    addEventListener: (name: string, fn: Function) => {
      (handlers[name] ??= []).push(fn);
    },
  };
  const window: any = {
    crypto: webcrypto,
    __WEB_GAME_STUDIO_AGENT__: agent,
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
    setInterval: (fn: Function) => { const key = ++timerId; timers.set(key, fn); return key; },
    clearInterval: (key: number) => timers.delete(key),
  });
  return {
    sdk: window.Blaze,
    legacy: window.GameMarketing,
    requests,
    handlers,
    localStorage,
    sessionStorage,
    document,
    tick: () => [...timers.values()].forEach((fn) => fn()),
  };
}
describe("SDK privacy and consent", () => {
  it("exposes Blaze and the legacy name as one API and preserves identity storage keys", () => {
    const h = harness();
    expect(h.sdk).toBe(h.legacy);
    h.legacy.init({ endpoint: "https://marketing.example", sdkKey: "key", consent: true });
    h.sdk.track("round_start");
    expect(h.requests.map((r) => r.events[0].name)).toEqual(["visit", "loaded", "round_start", "active_play"]);
    expect(h.localStorage.items.has("gm_player_key")).toBe(true);
    expect(h.sessionStorage.items.has("gm_session_key_id")).toBe(true);
  });
  it("ships identical SDK source and public copies", () => {
    expect(readFileSync("sdk/sdk.js", "utf8")).toBe(readFileSync("public/sdk.js", "utf8"));
  });
  it("does not send human events or write IDs in a marked worker session", async () => {
    const h = harness(true);
    h.sdk.init({ endpoint: "https://marketing.example", sdkKey: "key", consent: true });
    h.sdk.setConsent(true);
    h.sdk.track("first_action");
    expect((await h.sdk.startCapture({ consent: true })).status).toBe("agent_session");
    expect(h.requests).toHaveLength(0);
    expect(h.localStorage.items.size).toBe(0);
    expect(h.sessionStorage.items.size).toBe(0);
  });

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
    expect(h.requests).toHaveLength(4);
    const event = h.requests[2].events[0];
    expect(event.page).toBe("https://game.example/play");
    expect(event.referrer).toBe("https://ref.example/a");
    expect(event.properties).toEqual({ step: "level 1" });
    expect(event.kind).toBeUndefined();
    expect(JSON.stringify(h.requests)).not.toContain("secret");
    h.sdk.disable();
    h.sdk.track("exit");
    expect(h.requests).toHaveLength(4);
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
    expect(pointer.properties).toEqual({ x: 0.5, y: 1, surface: "viewport", screen: "viewport" });
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

it("measures only consented foreground play after trusted input and stops on completion", () => {
  vi.useFakeTimers();
  try {
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const h = harness(); h.sdk.init({endpoint:"https://marketing.example",sdkKey:"key",consent:true});
    h.handlers.keydown[0]({isTrusted:true});
    h.sdk.track("round_start");
    const durations = () => h.requests.filter((r) => r.events[0].name === "active_play").map((r) => r.events[0].properties.duration);
    expect(durations()).toEqual([0]);
    vi.setSystemTime(new Date("2026-01-01T00:00:15Z")); h.tick();
    expect(durations()).toEqual([0]);
    h.handlers.keydown[0]({isTrusted:false});
    vi.setSystemTime(new Date("2026-01-01T00:00:30Z")); h.tick();
    expect(durations()).toEqual([0]);
    h.handlers.keydown[0]({isTrusted:true});
    vi.setSystemTime(new Date("2026-01-01T00:00:40Z")); h.document.hidden=true; h.handlers.visibilitychange.forEach((fn) => fn());
    vi.setSystemTime(new Date("2026-01-01T00:00:45Z")); h.tick();
    expect(durations()).toEqual([0, 10]);
    vi.setSystemTime(new Date("2026-01-01T00:01:00Z")); h.tick(); expect(durations()).toEqual([0, 10]);
    h.document.hidden=false; h.handlers.visibilitychange.forEach((fn) => fn());
    h.handlers.keydown[0]({isTrusted:true});
    vi.setSystemTime(new Date("2026-01-01T00:01:15Z")); h.tick();
    expect(durations()).toEqual([0, 10, 15]);
    h.sdk.track("round_complete"); h.handlers.keydown[0]({isTrusted:true});
    vi.setSystemTime(new Date("2026-01-01T00:01:30Z")); h.tick(); expect(durations()).toEqual([0,10,15]);
  } finally { vi.useRealTimers(); }
});
