import { describe, expect, it } from "vitest";
import { DEFAULT_SCRIPT_REVIEW_ADAPTER, resolveScriptReviewAdapter } from "../src/lib/script-review-provider";

describe("script review provider registry", () => {
  it("selects the legacy adapter by default and rejects unknown or malformed configuration", () => {
    const adapter = resolveScriptReviewAdapter();
    expect(adapter.id).toBe(DEFAULT_SCRIPT_REVIEW_ADAPTER);
    expect(adapter.revision).toBeTruthy();
    expect(resolveScriptReviewAdapter(adapter.id)).toBe(adapter);
    for (const value of ["unknown", "", null, 1, "toString"]) expect(() => resolveScriptReviewAdapter(value)).toThrow(/administrator/);
  });
  it("validates billing and translates the provider response to rubric scores", () => {
    const adapter = resolveScriptReviewAdapter();
    const raw = { model: "typesafe/jev-1.14", answers: { hook: { type: "score", score: 3 }, pacing: { type: "score", score: 2 }, clarity: { type: "score", score: 4 }, shareability: { type: "score", score: 1 }, unsupported_claim: { type: "noul", noul: 0.2 } }, usage: { input_tokens: 1000, output_tokens: 0, cost: 0.000042 } };
    const admission = { maxBillableInputTokens: 2000, maxCostBoundUsd: 0.001 };
    expect(adapter.verifyBilling(raw, raw.model, admission).valid).toBe(true);
    expect(adapter.verifyBilling({ ...raw, usage: { ...raw.usage, cost: 0.02 } }, raw.model, admission).valid).toBe(false);
    expect(adapter.verifyBilling({ ...raw, model: "other" }, raw.model, admission).valid).toBe(false);
    expect(adapter.parse(raw, raw.model).score.overall).toBe(63);
    expect(() => adapter.parse({ ...raw, answers: {} }, raw.model)).toThrow();
  });
});

describe("rejected suggestions", () => {
  it("blocks approval and an unstarted review before provider dispatch", async () => {
    delete process.env.DATABASE_URL; delete process.env.VERCEL;
    process.env.LOCAL_DATABASE_PATH = "memory://";
    process.env.CREDENTIAL_KEY = Buffer.alloc(32, 19).toString("base64");
    process.env.BLAZE_JEV_SCRIPT_REVIEW_ENABLED = "true";
    const db = await import("../src/lib/db");
    const { hash } = await import("../src/lib/security");
    const credentials = await import("../src/lib/credentials");
    const studio = await import("../src/lib/content-studio");
    const scripts = await import("../src/lib/content-scripts");
    const { randomUUID } = await import("node:crypto");
    const { vi } = await import("vitest");
    await db.query("DELETE FROM records"); await db.query("DELETE FROM credentials");
    await db.put("ws", "game", { id: "dog", title: "Dog", url: "https://example.com", description: "", genre: "Action", image: "", sdkKey: "unused", origins: [], createdAt: "2026-10-30T00:00:00Z", dailyEnabled: false, competitors: [] });
    await db.put("ws", "game_profile", { id: "dog", gameId: "dog", result: "complete", lastRefresh: "2026-10-30T00:00:00Z", facts: [{ key: "manifest_description", value: "A runner dodges obstacles.", evidence: { source: "Game manifest", observedAt: "2026-10-30T00:00:00Z" } }] });
    await db.put("ws", "connection", { id: "jev", provider: "openrouter", connected: true, credentialVersion: "c1" });
    await credentials.saveSecret("ws", "jev", { token: "fixture", model: "typesafe/jev-1.14" });
    const encrypted = (await db.query<{ encrypted: string }>("SELECT encrypted FROM credentials WHERE workspace_id='ws' AND provider='jev'"))[0].encrypted;
    await db.put("ws", "jev_settings", { id: "default", connectionId: "jev", model: "typesafe/jev-1.14", revision: "j1", credentialVersion: `c1:${hash(encrypted)}` });
    const binding = await scripts.reviewServiceBinding("ws");
    expect(binding).toMatchObject({ connectionId: "jev", model: "typesafe/jev-1.14", settingsRevision: "j1", adapterId: "openrouter-decisions", adapterRevision: "1", availability: { enabled: true } });
    expect(binding).not.toHaveProperty("token");
    const idea = (await studio.prepareSourceIdeas("ws", "dog"))[0];
    const script = await scripts.saveContentScript("ws", idea.id);
    const generated = await scripts.saveContentScript("ws", idea.id, "A generated script showing the runner dodging obstacles.", script.revision, "generated");
    expect(generated.origin).toBe("generated");
    const proposal = await scripts.reviewScriptProposal("ws", generated.id);
    const grant = await scripts.approveScriptReview("ws", "owner", { scriptId: script.id, reviewHash: proposal.reviewHash, requestId: randomUUID(), maxCostCents: 1 });
    await db.put("ws", "content_rejection", { id: idea.id });
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    try {
      await expect(scripts.startScriptReview("ws", grant.id)).rejects.toThrow(/rejected/);
      await expect(scripts.approveScriptReview("ws", "owner", { scriptId: script.id, reviewHash: proposal.reviewHash, requestId: randomUUID(), maxCostCents: 1 })).rejects.toThrow(/rejected/);
      expect(fetch).not.toHaveBeenCalled();
    } finally { vi.unstubAllGlobals(); delete process.env.BLAZE_JEV_SCRIPT_REVIEW_ENABLED; }
  });
});
