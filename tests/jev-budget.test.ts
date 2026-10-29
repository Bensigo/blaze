import { beforeAll, beforeEach, afterAll, it, expect, vi } from "vitest";
let db: typeof import("../src/lib/db"),
  b: typeof import("../src/lib/jev-budget"),
  automation: typeof import("../src/lib/game-automation");
const keyData = () => ({
  data: {
    label: "DO_NOT_RETURN_SECRET",
    limit: 0.01,
    limit_remaining: 0.01,
    limit_reset: null,
    include_byok_in_limit: true,
    is_management_key: false,
    usage: 0,
    budgets: [],
    effective_budget: null,
  },
});
const price = () => ({
  data: {
    id: "typesafe/jev-1.14",
    architecture: {
      input_modalities: ["text"],
      output_modalities: ["decisions"],
    },
    endpoints: [
      {
        provider_name: "TypeSafe",
        status: 0,
        pricing: { prompt: "0.000000042", completion: "0", discount: 0 },
      },
    ],
  },
});
let keyOverride: unknown,
  priceOverride: unknown,
  delay = 0;
beforeAll(async () => {
  delete process.env.DATABASE_URL;
  delete process.env.VERCEL;
  process.env.LOCAL_DATABASE_PATH = "memory://";
  process.env.CREDENTIAL_KEY = Buffer.alloc(32, 31).toString("base64");
  process.env.APP_URL = "https://blaze.example";
  db = await import("../src/lib/db");
  b = await import("../src/lib/jev-budget");
  automation = await import("../src/lib/game-automation");
}, 30000);
afterAll(async () => {
  await db.closeDatabase();
  vi.unstubAllGlobals();
});
beforeEach(async () => {
  await db.query("DELETE FROM records");
  await db.query("DELETE FROM jobs");
  await db.query("DELETE FROM credentials");
  const { encrypt, hash } = await import("../src/lib/security");
  const encrypted = await encrypt({ token: "controlled-not-real-key" });
  await db.query(
    "INSERT INTO credentials(workspace_id,provider,encrypted) VALUES('w','c',$1)",
    [encrypted],
  );
  await db.put("w", "connection", {
    id: "c",
    provider: "openrouter",
    connected: true,
    credentialVersion: "v",
  });
  await db.put("w", "jev_settings", {
    id: "default",
    connectionId: "c",
    model: "typesafe/jev-1.14",
    revision: "rev",
    credentialVersion: "v:" + hash(encrypted),
  });
  await db.put("w", "game", {
    id: "g",
    title: "Controlled",
    url: "https://blaze.example/fixture/decision-validation.html",
    manifestSource: { sha256: "build1" },
  });
  keyOverride = undefined;
  priceOverride = undefined;
  delay = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input) => {
      if (delay) await new Promise((r) => setTimeout(r, delay));
      const url = String(input);
      if (url === "https://openrouter.ai/api/v1/key")
        return Response.json(keyOverride ?? keyData());
      if (
        url ===
        "https://openrouter.ai/api/v1/models/typesafe/jev-1.14/endpoints"
      )
        return Response.json(priceOverride ?? price());
      throw Error("Unexpected provider request");
    }),
  );
});
const approve = () =>
  b.approveJevValidation("w", "owner", {
    operation: "approve",
    gameId: "g",
    maxKeyLimitUSD: 0.01,
    acceptResidualRisk: true,
  });
const rec = (approvalId: string, id = "r") => ({
  id,
  gameId: "g",
  title: "Controlled validation",
  mode: "jev" as const,
  status: "queued" as const,
  createdAt: new Date().toISOString(),
  paidApprovalId: approvalId,
  maxActions: 1,
  maxDurationSeconds: 30,
});
it("observes lifetime controls while refusing to claim an exact total guarantee or return key labels", () => {
  const c = b.parseKeyControls(keyData());
  expect(b.assessKeyControls(c)).toMatchObject({
    state: "controls_observed",
    providerEnforced: true,
    exactTotalGuaranteed: false,
  });
  expect(JSON.stringify(c)).not.toContain("DO_NOT_RETURN_SECRET");
});
it.each([
  { limit: null, limit_remaining: null },
  { limit_reset: "daily" },
  { limit_remaining: 0 },
  { limit_remaining: -0.1 },
  { limit_remaining: 0.02 },
  { is_management_key: true },
  { limit_reset: undefined },
])("fails closed for invalid or unsuitable control %j", (patch) => {
  const data = keyData();
  Object.assign(data.data, patch);
  expect(b.assessKeyControls(b.parseKeyControls(data)).state).toBe(
    "setup_required",
  );
});
it("applies an exhausted workspace/effective budget even with key credit remaining", () => {
  const value = {
    scope: "workspace",
    limit_usd: 1,
    spend_usd: 1,
    remaining_usd: 0,
    reset_interval: null,
    resets_at: null,
    include_byok: true,
  };
  const d = keyData();
  Object.assign(d.data, { budgets: [value], effective_budget: value });
  expect(b.assessKeyControls(b.parseKeyControls(d)).state).toBe(
    "setup_required",
  );
});
it.each(["", "-1", "NaN", "1e-8"])(
  "rejects malformed decimal pricing %s",
  async (prompt) => {
    const p = price();
    p.data.endpoints[0].pricing.prompt = prompt;
    priceOverride = p;
    await expect(b.verifyJevBudget("w")).rejects.toThrow();
  },
);
it("rejects an unknown potentially chargeable pricing component", async () => {
  const p = price();
  Object.assign(p.data.endpoints[0].pricing, { new_fee: "1" });
  priceOverride = p;
  await expect(b.verifyJevBudget("w")).rejects.toThrow();
});
it("requires explicit residual-risk acceptance before approval", async () => {
  await expect(
    b.approveJevValidation("w", "owner", {
      operation: "approve",
      gameId: "g",
      maxKeyLimitUSD: 0.01,
      acceptResidualRisk: false,
    } as never),
  ).rejects.toThrow();
  expect(await db.get("w", "jev_validation", "default")).toBeUndefined();
});
it("queues one approved validation atomically with controlled-target provenance, and consumes once at claim", async () => {
  const a = await approve();
  expect(await automation.enqueueRecording("w", rec(a.approvalId))).toBe(true);
  const r = await db.get<import("../src/lib/types").Recording>(
    "w",
    "recording",
    "r",
  );
  expect(r?.targetProvenance).toBe("controlled_lab");
  expect((await db.get<any>("w", "jev_validation", "default")).status).toBe(
    "reserved",
  );
  await db.query(
    "UPDATE jobs SET state='claimed',lease_until=now()+interval '1 minute' WHERE id='r'",
  );
  await b.consumeJevValidation("w", r!);
  await b.assertJevDispatch("w", r!);
  await expect(b.consumeJevValidation("w", r!)).rejects.toThrow();
  await b.revokeJevValidation("w");
  await expect(b.assertJevDispatch("w", r!)).rejects.toThrow();
  expect(fetch).not.toHaveBeenCalledWith(
    "https://openrouter.ai/api/v1/systemone",
    expect.anything(),
  );
});
it("has one winner for two concurrent queues against the same approval", async () => {
  const a = await approve();
  const outcomes = await Promise.allSettled([
    automation.enqueueRecording("w", rec(a.approvalId, "r1")),
    automation.enqueueRecording("w", rec(a.approvalId, "r2")),
  ]);
  expect(outcomes.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(
    (await db.query("SELECT id FROM jobs WHERE kind='recording'")).length,
  ).toBe(1);
});
it("rolls the reservation back if the game recording gate rejects enqueue", async () => {
  const a = await approve();
  await db.put("w", "recording_gate", { id: "g", active: "occupied" });
  await expect(
    automation.enqueueRecording("w", rec(a.approvalId)),
  ).rejects.toThrow();
  expect((await db.get<any>("w", "jev_validation", "default")).status).toBe(
    "approved",
  );
  expect(
    await db.query("SELECT id FROM jobs WHERE kind='recording'"),
  ).toHaveLength(0);
});
it("rejects retargeting after approval and after enqueue", async () => {
  const a = await approve();
  await db.put("w", "game", { id: "g", url: "https://other.example/game" });
  await expect(
    automation.enqueueRecording("w", rec(a.approvalId)),
  ).rejects.toThrow();
  await db.put("w", "game", {
    id: "g",
    url: "https://blaze.example/fixture/decision-validation.html",
    manifestSource: { sha256: "build1" },
  });
  await automation.enqueueRecording("w", rec(a.approvalId));
  await db.query(
    "UPDATE jobs SET state='claimed',lease_until=now()+interval '1 minute' WHERE id='r'",
  );
  await db.put("w", "game", { id: "g", url: "https://other.example/game" });
  await expect(
    b.consumeJevValidation("w", rec(a.approvalId)),
  ).rejects.toThrow();
});
it("does not replace a reserved approval even before its job exists", async () => {
  const a = await approve();
  await db.query(
    "UPDATE records SET body=jsonb_set(body,'{status}','\"reserved\"') WHERE kind='jev_validation'",
  );
  await expect(approve()).rejects.toThrow("previous validation");
  expect((await db.get<any>("w", "jev_validation", "default")).approvalId).toBe(
    a.approvalId,
  );
});
it("refuses dispatch when the lease has expired", async () => {
  const a = await approve();
  await automation.enqueueRecording("w", rec(a.approvalId));
  await db.query(
    "UPDATE jobs SET state='claimed',lease_until=now()-interval '1 second' WHERE id='r'",
  );
  await expect(
    b.consumeJevValidation("w", rec(a.approvalId)),
  ).rejects.toThrow();
});
it("rejects controls or price changed since approval", async () => {
  const a = await approve();
  const d = keyData();
  d.data.limit = 0.02;
  keyOverride = d;
  await expect(
    automation.enqueueRecording("w", rec(a.approvalId)),
  ).rejects.toThrow();
  keyOverride = undefined;
  const p = price();
  p.data.endpoints[0].pricing.prompt = ".5";
  priceOverride = p;
  await expect(
    automation.enqueueRecording("w", rec(a.approvalId)),
  ).rejects.toThrow();
});

it("will not reserve after expiry passes during provider reads", async () => {
  const a = await approve();
  const grant = await db.get<any>("w", "jev_validation", "default");
  await db.put("w", "jev_validation", {
    ...grant,
    expiresAt: new Date(Date.now() + 500).toISOString(),
  });
  delay = 650;
  await expect(
    automation.enqueueRecording("w", rec(a.approvalId)),
  ).rejects.toThrow();
  expect(
    await db.query("SELECT id FROM jobs WHERE kind='recording'"),
  ).toHaveLength(0);
});
it("pins manifest build changes even when target URL is unchanged", async () => {
  const a = await approve();
  await db.put("w", "game", {
    id: "g",
    url: "https://blaze.example/fixture/decision-validation.html",
    manifestSource: { sha256: "build2" },
  });
  await expect(
    automation.enqueueRecording("w", rec(a.approvalId)),
  ).rejects.toThrow();
});
it("authorizes one late request slot and rejects duplicate, revocation and stale lease", async () => {
  const a = await approve();
  await automation.enqueueRecording("w", rec(a.approvalId));
  await db.query(
    "UPDATE jobs SET state='claimed',lease_until=now()+interval '1 minute' WHERE id='r'",
  );
  const r = await db.get<import("../src/lib/types").Recording>(
    "w",
    "recording",
    "r",
  );
  await b.consumeJevValidation("w", r!);
  expect(await b.authorizeJevRequest("w", "r")).toEqual({
    allowed: true,
    maxRequests: 1,
  });
  await expect(b.authorizeJevRequest("w", "r")).rejects.toThrow();
  await b.revokeJevValidation("w");
  await expect(b.authorizeJevRequest("w", "r")).rejects.toThrow();
});

it("claims the approved bounded job with a capable worker, then authorizes only its one request", async () => {
  const a = await approve();
  await automation.enqueueRecording("w", rec(a.approvalId));
  const jobs = await import("../src/lib/jobs");
  const job = await jobs.claimJob("jev-budget-v1");
  expect(job).toMatchObject({
    recording: { id: "r", targetProvenance: "controlled_lab" },
    jevModel: "typesafe/jev-1.14",
    jevKey: "controlled-not-real-key",
    limits: { maxActions: 1, maxDurationSeconds: 30 },
  });
  expect(await b.authorizeJevRequest("w", "r")).toEqual({
    allowed: true,
    maxRequests: 1,
  });
  await expect(b.authorizeJevRequest("w", "r")).rejects.toThrow();
  expect(
    automation.actualJev({
      ...rec(a.approvalId),
      targetProvenance: "controlled_lab",
      status: "ready",
      duration: 1,
      videoUrl: "/api/media/media_x",
      actions: [{ id: "left", at: 0 }],
    }),
  ).toBe(false);
});

it("supports the observed five-dollar lifetime key without inventing a BYOK or lower-limit requirement", () => {
  const d = keyData();
  Object.assign(d.data, {
    limit: 5,
    limit_remaining: 5,
    include_byok_in_limit: false,
  });
  expect(b.assessKeyControls(b.parseKeyControls(d))).toMatchObject({
    state: "controls_observed",
    providerEnforced: true,
    exactTotalGuaranteed: false,
  });
});
