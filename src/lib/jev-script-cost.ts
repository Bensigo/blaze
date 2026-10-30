import { z } from "zod";
import { HttpError } from "./http-error";

// Verified 2026-10-30: OpenRouter uses default mode for short text-only requests;
// TypeSafe rejects requests beyond 64k combined state+ALL questions (32k/one
// question). State is ingested once. 65,536 is conservative for documented 64k.
// This is a documented admission bound, not an API total-dollar cutoff.
export const JEV_SCRIPT_COST_POLICY = {
  revision: "jev-1.14-default-context-16kib-2026-10-30",
  maxRequestBytes: 16 * 1024,
  questionCount: 5,
  maxBillableInputTokens: 65536,
  inputNanoUsdPerToken: 42, // $0.042 per million input tokens
  outputNanoUsdPerToken: 0,
  approvedMaxCostCents: 1,
  defaultModeSource: "https://openrouter.ai/docs/guides/community/jev#frequently-asked-questions",
  contextSource: "https://docs.typesafe.ai/models#context-length",
  billingSource: "https://docs.typesafe.ai/api/system-one",
  rejectionSource: "https://docs.typesafe.ai/api/errors",
} as const;
const scoreQuestion = z.object({ type: z.literal("score"), instructions: z.string(), criteria: z.array(z.string()).length(5) }).strict();
const requestSchema = z.object({
  model: z.literal("typesafe/jev-1.14"),
  state: z.object({ script: z.string(), sourceFacts: z.array(z.string()).max(30), instruction: z.string() }).strict(),
  questions: z.object({ hook: scoreQuestion, pacing: scoreQuestion, clarity: scoreQuestion, shareability: scoreQuestion,
    unsupported_claim: z.object({ type: z.literal("noul"), instructions: z.string(), criteria: z.object({ false: z.string(), true: z.string() }).strict() }).strict(),
  }).strict(),
  provider: z.object({ only: z.tuple([z.literal("typesafe")]), allow_fallbacks: z.literal(false),
    max_price: z.object({ prompt: z.literal(0.042), completion: z.literal(0) }).strict(),
  }).strict(),
}).strict();
export function admitJevScriptRequest(value: unknown, requestHeaders?: HeadersInit) {
  // No assets/images, alternate models/providers, additional questions or hidden
  // long-context/provider headers. Arbitrary text remains data in fixed fields.
  const parsed = requestSchema.safeParse(value);
  if (!parsed.success) throw new HttpError(409, "The request is outside the one-cent Jev text-only cost policy.");
  const headers = new Headers(requestHeaders);
  for (const key of headers.keys()) if (!["authorization", "content-type"].includes(key)) throw new HttpError(409, "Additional provider headers are outside the one-cent cost policy.");
  const body = JSON.stringify(parsed.data);
  const inputBytes = Buffer.byteLength(body, "utf8");
  if (inputBytes > JEV_SCRIPT_COST_POLICY.maxRequestBytes) throw new HttpError(409, "The complete Jev request exceeds the 16384-byte one-cent limit. Shorten the script or sources.");
  const maxCostBoundNanoUsd = JEV_SCRIPT_COST_POLICY.maxBillableInputTokens * JEV_SCRIPT_COST_POLICY.inputNanoUsdPerToken;
  if (!Number.isSafeInteger(maxCostBoundNanoUsd) || maxCostBoundNanoUsd > JEV_SCRIPT_COST_POLICY.approvedMaxCostCents * 10000000) throw new HttpError(409, "The documented request bound exceeds the approved one-cent budget.");
  return { request: parsed.data, body, admission: {
    policyRevision: JEV_SCRIPT_COST_POLICY.revision, maxCostCents: JEV_SCRIPT_COST_POLICY.approvedMaxCostCents,
    maxBillableInputTokens: JEV_SCRIPT_COST_POLICY.maxBillableInputTokens, maxCostBoundNanoUsd,
    maxCostBoundUsd: maxCostBoundNanoUsd / 1e9, requestByteLimit: JEV_SCRIPT_COST_POLICY.maxRequestBytes,
    inputBytes, questionCount: JEV_SCRIPT_COST_POLICY.questionCount,
  } };
}
