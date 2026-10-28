import { describe, it, expect, vi } from "vitest";
import { publicIPv4, validateGameUrl } from "../worker/safety";
describe("worker network boundaries", () => {
  it("rejects local and reserved IPv4 space", () => {
    for (const ip of [
      "0.1.2.3",
      "10.1.2.3",
      "127.0.0.1",
      "169.254.169.254",
      "172.16.1.1",
      "192.168.1.1",
      "100.64.0.1",
      "198.18.0.1",
      "203.0.113.1",
      "224.0.0.1",
      "::1",
    ])
      expect(publicIPv4(ip), ip).toBe(false);
    expect(publicIPv4("8.8.8.8")).toBe(true);
  });
  it("permits only the explicitly enabled local fixture", async () => {
    await expect(
      validateGameUrl("http://127.0.0.1:3000/fixture/index.html", false),
    ).rejects.toThrow();
    await expect(
      validateGameUrl("http://127.0.0.1:3000/admin", true),
    ).rejects.toThrow();
    const result = await validateGameUrl(
      "http://127.0.0.1:3000/fixture/index.html?secret=x#fragment",
      true,
    );
    expect(result.url).toBe("http://127.0.0.1:3000/fixture/index.html");
    await expect(
      validateGameUrl("https://user:pass@example.com", false),
    ).rejects.toThrow();
  });
});

import {
  RunEvidence,
  failureCode,
  safePhase,
  safeErrorName,
} from "../worker/observations";
describe("recording evidence", () => {
  it("uses the video clock and final media duration instead of setup and upload time", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(0);
      const run = new RunEvidence();
      vi.advanceTimersByTime(12000);
      run.beginCapture();
      vi.advanceTimersByTime(2000);
      run.state({ phase: "playing" }, '{}');
      run.action();
      vi.advanceTimersByTime(4000);
      run.endCapture(5.75);
      vi.advanceTimersByTime(20000);
      const rows = run.finish({ fixture: true, screenshotUrl: "/api/media/test", screenshotAt: 6 });
      expect(rows.find(row => row.text.includes("phase: playing"))?.at).toBe(2);
      expect(rows.find(row => row.text.includes("1 actions"))?.at).toBe(5.75);
      expect(rows.every(row => row.at <= 5.75)).toBe(true);
      expect(run.now()).toBe(5.75);
    } finally { vi.useRealTimers(); }
  });
  it("records bounded phase changes, counts, and a screenshot at its capture time", () => {
    const run = new RunEvidence(Date.now() - 5000);
    run.state({ phase: "ready" }, '{"phase":"ready"}');
    run.action();
    run.state({ phase: "playing" }, '{"phase":"playing"}');
    run.modelDecision();
    run.action();
    run.state({ phase: "won" }, '{"phase":"won"}');
    run.blockedRequest();
    run.pageError("TypeError");
    const rows = run.finish({
      fixture: false,
      screenshotUrl: "/api/media/test",
      screenshotAt: 3,
    });
    expect(
      rows.some(
        (r) =>
          r.text.includes("2 actions and 1 Jev model decisions") &&
          r.text.includes("completion observed"),
      ),
    ).toBe(true);
    expect(
      rows.some((r) => r.text.includes("coverage") && r.type === "observation"),
    ).toBe(true);
    expect(rows.find((r) => r.screenshotUrl)?.at).toBe(3);
    expect(
      rows.some(
        (r) => r.text === "Game page reported TypeError." && r.type === "error",
      ),
    ).toBe(true);
  });
  it("labels repeated state as a hypothesis and never returns raw error or unknown phase", () => {
    const run = new RunEvidence();
    for (let i = 0; i < 10; i++) run.state({ phase: "secret-token" }, "{}");
    run.pageError("secret-token");
    const rows = run.finish({
      fixture: true,
      failure: failureCode(new Error("oops secret-token")),
    });
    expect(rows.some((r) => r.type === "hypothesis")).toBe(true);
    expect(JSON.stringify(rows)).not.toContain("secret-token");
    expect(safePhase("token-value")).toBe("unclassified");
    expect(safeErrorName("token-value")).toBe("Error");
    expect(failureCode(new Error("oops secret-token"))).toBe("worker_failed");
  });
});
