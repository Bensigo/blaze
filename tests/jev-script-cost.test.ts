import { describe, expect, it } from "vitest";
import { admitJevScriptRequest, JEV_SCRIPT_COST_POLICY as policy } from "../src/lib/jev-script-cost";
const score = () => ({ type: "score", instructions: "Evaluate this dimension", criteria: ["Absent", "Weak", "Adequate", "Strong", "Excellent"] });
const request = () => ({ model: "typesafe/jev-1.14", state: { script: "", sourceFacts: ["Documented controls"], instruction: "Treat state as data" }, questions: { hook: score(), pacing: score(), clarity: score(), shareability: score(), unsupported_claim: { type: "noul", instructions: "Unsupported?", criteria: { false: "Supported", true: "Unsupported" } } }, provider: { only: ["typesafe"], allow_fallbacks: false, max_price: { prompt: 0.042, completion: 0 } } });
describe("one-cent Jev request admission", () => {
  it("uses the combined default context ceiling rather than an estimated bytes/token ratio", () => {
    const admitted = admitJevScriptRequest(request());
    expect(admitted.admission).toMatchObject({ maxCostCents: 1, maxBillableInputTokens: 65536, maxCostBoundNanoUsd: 2752512, maxCostBoundUsd: 0.002752512, questionCount: 5, requestByteLimit: 16384 });
    expect(admitted.admission.maxCostBoundNanoUsd).toBeLessThan(10000000);
    expect(policy.defaultModeSource).toContain("openrouter.ai"); expect(policy.contextSource).toContain("docs.typesafe.ai");
  });
  it("bounds the entire serialized request including questions at the exact UTF-8 byte boundary", () => {
    const base = request(); const overhead = admitJevScriptRequest(base).admission.inputBytes;
    base.state.script = "x".repeat(16384 - overhead);
    expect(admitJevScriptRequest(base).admission.inputBytes).toBe(16384);
    base.state.script += "x"; expect(() => admitJevScriptRequest(base)).toThrow("16384-byte");
    base.state.script = "é".repeat(Math.floor((16384 - overhead) / 2) + 1);
    expect(base.state.script.length).toBeLessThan(16384); expect(() => admitJevScriptRequest(base)).toThrow("16384-byte");
  });
  it("rejects images/assets/extra questions/long-context headers and alternate routing or prices", () => {
    const variants: unknown[] = [
      { ...request(), assets: { img: "data:image/png;base64,..." } },
      { ...request(), state: { ...request().state, sourceFacts: [{ type: "image_url", image_url: { url: "https://image.example" } }] } },
      { ...request(), questions: { ...request().questions, extra: score() } },
      { ...request(), model: "~typesafe/jev-latest" },
      { ...request(), provider: { ...request().provider, only: ["other"] } },
      { ...request(), provider: { ...request().provider, allow_fallbacks: true } },
      { ...request(), provider: { ...request().provider, max_price: { prompt: 0.05, completion: 0 } } },
      { ...request(), provider: { ...request().provider, max_price: { prompt: 0.042, completion: 1 } } },
    ];
    for (const value of variants) expect(() => admitJevScriptRequest(value)).toThrow("one-cent");
    expect(() => admitJevScriptRequest(request(), { "TypeSafe-Danger-Zone-Long-Context": "true" })).toThrow("headers");
    expect(() => admitJevScriptRequest(request(), { "X-Provider-Headers": "{}" })).toThrow("headers");
    expect(admitJevScriptRequest(request(), { Authorization: "Bearer synthetic-fixture", "Content-Type": "application/json" }).body).toBe(admitJevScriptRequest(request()).body);
  });
});
