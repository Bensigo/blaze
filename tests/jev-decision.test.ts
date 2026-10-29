import { afterEach, describe, expect, it, vi } from "vitest";
import { choose } from "../worker/jev-decision";
import { RunEvidence } from "../worker/observations";
const actions = [
  { id: "left", label: "Move left" },
  { id: "right", label: "Move right" },
];
afterEach(() => vi.unstubAllGlobals());
describe("Jev decision transport", () => {
  it("sends the pinned decision model and state to OpenRouter System One", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({
            model: "typesafe/jev-1.13-20260917",
            answers: { next: { type: "choice", choice: "left" } },
          }),
        ),
      );
    vi.stubGlobal("fetch", fetcher);
    expect(
      await choose({ turn: 1 }, actions, "mock-key", "typesafe/jev-1.13", 12000, async () => {}),
    ).toBe("left");
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe("https://openrouter.ai/api/v1/systemone");
    expect(init.headers.Authorization).toBe("Bearer mock-key");
    expect(init.redirect).toBe("error");
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.parse(init.body)).toEqual({
      model: "typesafe/jev-1.13",
      state: '{"turn":1}',
      questions: {
        next: {
          type: "choice",
          instructions:
            "Choose the next gameplay action from the allowed options.",
          criteria: { left: "Move left", right: "Move right" },
        },
      },
    });
  });
  it.each([
    { type: "choice", choice: "unknown" },
    { type: "noul", choice: "left" },
    { type: "choice", choice: 3 },
  ])("rejects invalid choices %j", async (answer) => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(
            JSON.stringify({
              model: "typesafe/jev-1.13-20260917",
              answers: { next: answer },
            }),
          ),
        ),
    );
    await expect(
      choose({}, actions, "mock-key", "typesafe/jev-1.13", 12000, async () => {}),
    ).rejects.toThrow("invalid action");
  });
  it.each([
    undefined,
    "typesafe/jev-1.14-20261001",
    "typesafe/jev-router",
    "typesafe/jev-1.13-extra",
  ])("rejects unexpected resolved model %s", async (resolved) => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(
            JSON.stringify({
              model: resolved,
              answers: { next: { type: "choice", choice: "left" } },
            }),
          ),
        ),
    );
    await expect(
      choose({}, actions, "mock-key", "typesafe/jev-1.13", 12000, async () => {}),
    ).rejects.toThrow("invalid action");
  });
  it("bounds responses and sanitizes provider and timeout errors", async () => {
    for (const result of [
      new Response("x".repeat(65537)),
      new Response("mock-key leaked", { status: 401 }),
    ]) {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(result));
      await expect(
        choose({}, actions, "mock-key", "typesafe/jev-1.13", 12000, async () => {}),
      ).rejects.toThrow("Jev decision failed or returned an invalid action");
    }
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("mock-key timeout")),
    );
    await expect(
      choose({}, actions, "mock-key", "typesafe/jev-1.13", 12000, async () => {}),
    ).rejects.toThrow("Jev decision failed or returned an invalid action");
  });
  it("rejects unknown models and malformed action IDs before calling provider", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    await expect(
      choose({}, actions, "mock-key", "typesafe/jev-router", 12000, async () => {}),
    ).rejects.toThrow("Invalid Jev decision request");
    await expect(
      choose(
        {},
        [{ id: "bad id", label: "bad" }, actions[0]],
        "mock-key",
        "typesafe/jev-1.13",
        12000, async () => {},
      ),
    ).rejects.toThrow("Invalid Jev decision request");
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("rejects oversized state, UTF-8 request, labels and action sets before fetch", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    for (const [state, choices] of [
      [{ text: "a".repeat(8001) }, actions],
      [
        { text: "😀".repeat(3500) },
        Array.from({ length: 20 }, (_, i) => ({
          id: `a${i}`,
          label: "界".repeat(120),
        })),
      ],
      [{}, [{ id: "left", label: "x".repeat(121) }, actions[1]]],
      [
        {},
        Array.from({ length: 21 }, (_, i) => ({ id: `a${i}`, label: "ok" })),
      ],
    ] as const)
      await expect(
        choose(
          state,
          choices as { id: string; label: string }[],
          "mock-key",
          "typesafe/jev-1.13",
          12000, async () => {},
        ),
      ).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("does not retry a failed provider call", async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error("network"));
    vi.stubGlobal("fetch", fetcher);
    await expect(
      choose({}, actions, "mock-key", "typesafe/jev-1.13", 12000, async () => {}),
    ).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("fails closed when the authorization hook is missing", async () => {
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    // @ts-expect-error Runtime defense for untyped callers.
    await expect(choose({}, actions, "mock-key", "typesafe/jev-1.13")).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("runs authorization once immediately before the provider fetch", async () => {
    const order: string[] = [];
    const fetcher = vi.fn().mockImplementation(async () => {
      order.push("fetch");
      return new Response(
        JSON.stringify({
          model: "typesafe/jev-1.13",
          answers: { next: { type: "choice", choice: "left" } },
        }),
      );
    });
    vi.stubGlobal("fetch", fetcher);
    const authorize = vi.fn().mockImplementation(async () => {
      order.push("authorize");
    });
    expect(
      await choose(
        {},
        actions,
        "mock-key",
        "typesafe/jev-1.13",
        12000,
        authorize,
      ),
    ).toBe("left");
    expect(order).toEqual(["authorize", "fetch"]);
    expect(authorize).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("never fetches after authorization rejects and never authorizes an oversized request", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    const denied = vi.fn().mockRejectedValue(new Error("denied"));
    await expect(
      choose({}, actions, "mock-key", "typesafe/jev-1.13", 12000, denied),
    ).rejects.toThrow();
    expect(denied).toHaveBeenCalledTimes(1);
    expect(fetcher).not.toHaveBeenCalled();
    const authorize = vi.fn();
    await expect(
      choose(
        { text: "x".repeat(8001) },
        actions,
        "mock-key",
        "typesafe/jev-1.13",
        12000,
        authorize,
      ),
    ).rejects.toThrow();
    expect(authorize).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each([
    ["returned", { input_tokens: 275, output_tokens: 20, cost: 0.00003 }],
    ["missing", undefined],
    ["invalid", { input_tokens: "10", output_tokens: -1, cost: "0.1" }],
  ])(
    "records dispatch and %s usage without copying response data",
    async (_name, usage) => {
      const evidence = new RunEvidence();
      vi.stubGlobal(
        "fetch",
        vi
          .fn()
          .mockResolvedValue(
            new Response(
              JSON.stringify({
                model: "typesafe/jev-1.13",
                answers: { next: { type: "choice", choice: "left" } },
                usage,
                secret: "do-not-copy",
              }),
            ),
          ),
      );
      await choose(
        {},
        actions,
        "mock-key",
        "typesafe/jev-1.13",
        12000,
        async () => {},
        (event) => evidence.auditJev(event),
      );
      const text = evidence
        .finish({ fixture: false })
        .map((x) => x.text)
        .join("\n");
      expect(text.match(/Jev dispatch intent/g)).toHaveLength(1);
      expect(text).toContain("resolved model typesafe/jev-1.13");
      expect(text).toContain(
        usage?.input_tokens === 275
          ? "input tokens 275"
          : "input tokens unavailable",
      );
      expect(text).toContain(
        usage?.cost === 0.00003
          ? "provider cost USD 0.00003"
          : "provider cost USD unavailable",
      );
      expect(text).not.toContain("do-not-copy");
    },
  );
  it("retains dispatch intent and unavailable usage on fetch failure", async () => {
    const evidence = new RunEvidence();
    const fetcher = vi.fn().mockRejectedValue(new Error("secret"));
    vi.stubGlobal("fetch", fetcher);
    await expect(
      choose(
        {},
        actions,
        "mock-key",
        "typesafe/jev-1.13",
        12000,
        async () => {},
        (event) => evidence.auditJev(event),
      ),
    ).rejects.toThrow();
    const text = evidence
      .finish({ fixture: false, failure: "model_request_failed" })
      .map((x) => x.text)
      .join("\n");
    expect(text).toContain("Jev dispatch intent 1");
    expect(text).toContain("usage and cost unavailable");
    expect(text).not.toContain("secret");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
