import { z } from "zod";
import { get, put, query, id } from "./db";
import { secretFor } from "./credentials";
import { hash } from "./security";
import { AccountSettingsError } from "./ai-settings";
import type { ProviderSecret, Recording, Game } from "./types";

const canonical = (v: unknown): string =>
  JSON.stringify(v, (_k, value) =>
    value && typeof value === "object" && !Array.isArray(value)
      ? Object.fromEntries(
          Object.entries(value).sort(([a], [b]) => a.localeCompare(b)),
        )
      : value,
  );
const same = (a: unknown, b: unknown) => canonical(a) === canonical(b);
const money = z.number().finite().min(0).max(1e9);
const remaining = z.number().finite().min(-1e9).max(1e9);
const budget = z.object({
  scope: z.enum([
    "workspace_default_member",
    "workspace_default_key",
    "member",
    "api_key",
    "workspace",
    "key_limit",
  ]),
  limit_usd: money,
  spend_usd: money,
  remaining_usd: remaining,
  reset_interval: z.enum(["daily", "weekly", "monthly"]).nullable(),
  resets_at: z.string().nullable(),
  include_byok: z.boolean(),
});
const keySchema = z.object({
  data: z.object({
    limit: money.nullable(),
    limit_remaining: remaining.nullable(),
    limit_reset: z.enum(["daily", "weekly", "monthly"]).nullable().optional(),
    include_byok_in_limit: z.boolean().optional(),
    usage: money.optional(),
    byok_usage: money.optional(),
    budgets: z.array(budget).max(32).optional(),
    effective_budget: budget.nullable().optional(),
    is_management_key: z.boolean().optional(),
    is_provisioning_key: z.boolean().optional(),
    expires_at: z.string().nullable().optional(),
  }),
});
export type KeyControls = ReturnType<typeof parseKeyControls>;
/** Deliberately omit label, key fragments, user/workspace IDs and unknown fields. */
export function parseKeyControls(value: unknown) {
  const d = keySchema.parse(value).data;
  return {
    limitUSD: d.limit,
    remainingUSD: d.limit_remaining,
    reset: d.limit_reset,
    includeBYOK: d.include_byok_in_limit,
    usageUSD: d.usage ?? null,
    byokUSD: d.byok_usage ?? null,
    budgets: d.budgets ?? [],
    effectiveBudget: d.effective_budget ?? null,
    management:
      d.is_management_key === true || d.is_provisioning_key === true
        ? true
        : d.is_management_key === false
          ? false
          : null,
    expiresAt: d.expires_at ?? null,
  };
}
export function assessKeyControls(controls: KeyControls, now = Date.now()) {
  const reasons: string[] = [];
  if (controls.limitUSD === null)
    reasons.push("Set a finite per-key USD credit limit.");
  if (controls.reset !== null)
    reasons.push(
      "Use an explicitly reported non-resetting lifetime key limit.",
    );
  if (controls.management !== false)
    reasons.push("Use an inference key, not a management/provisioning key.");
  if (
    controls.remainingUSD === null ||
    controls.remainingUSD <= 0 ||
    controls.limitUSD === 0 ||
    controls.budgets.some((b) => b.remaining_usd <= 0) ||
    (controls.effectiveBudget && controls.effectiveBudget.remaining_usd <= 0)
  )
    reasons.push(
      "The key or an applicable provider budget is exhausted or unknown.",
    );
  if (
    controls.limitUSD !== null &&
    controls.remainingUSD !== null &&
    controls.remainingUSD > controls.limitUSD + 1e-9
  )
    reasons.push(
      "Provider remaining allowance is inconsistent with the key limit.",
    );
  if (
    controls.expiresAt &&
    (!Number.isFinite(Date.parse(controls.expiresAt)) ||
      Date.parse(controls.expiresAt) <= now)
  )
    reasons.push("The provider key expiry is invalid or elapsed.");
  return {
    state: reasons.length ? "setup_required" : "controls_observed",
    reasons,
    providerEnforced:
      controls.limitUSD !== null &&
      controls.remainingUSD !== null &&
      controls.management === false,
    exactTotalGuaranteed: false as const,
    residualExposure:
      "In-flight settlement can exceed a provider budget. Other callers, account auto-recharge and non-inference fees are not controlled by this one-run reservation. BYOK inclusion is reported separately; this pinned System One request sends no separate provider key. Endpoint-specific enforcement is not live-tested.",
  };
}
export const publicBudgetCheck = (c: JevBudgetCheck) => ({
  checkedAt: c.checkedAt,
  controls: c.controls,
  assessment: c.assessment,
  prices: c.prices,
});
export const publicValidationApproval = (a: JevValidationApproval) => ({
  approvalId: a.approvalId,
  gameId: a.gameId,
  status: a.status,
  expiresAt: a.expiresAt,
  maxKeyLimitUSD: a.maxKeyLimitUSD,
});
function target(game: Game) {
  const u = new URL(game.url);
  if (u.username || u.password || u.search || u.hash)
    throw new AccountSettingsError(
      "Use an exact game URL without credentials, query or fragment.",
    );
  return {
    url: game.url,
    manifest: game.manifestSource?.sha256 ?? null,
    network: game.networkPolicy ?? null,
  };
}
async function targetMatches(workspace: string, grant: JevValidationApproval) {
  const game = await get<Game>(workspace, "game", grant.gameId);
  return !!game && same(target(game), grant.target);
}
async function metadata(url: string, token?: string) {
  try {
    const r = await fetch(url, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(10000),
    });
    if (!r.ok || !r.body) throw Error();
    const reader = r.body.getReader();
    const chunks: Uint8Array[] = [];
    let n = 0;
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      n += part.value.byteLength;
      if (n > 65536) {
        await reader.cancel();
        throw Error();
      }
      chunks.push(part.value);
    }
    const bytes = new Uint8Array(n);
    let i = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, i);
      i += chunk.length;
    }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new AccountSettingsError(
      "Provider budget metadata could not be verified. No Jev request was made.",
    );
  }
}
export async function readOpenRouterKeyControls(token: string) {
  return parseKeyControls(
    await metadata("https://openrouter.ai/api/v1/key", token),
  );
}
export async function readJevPrice(model: string) {
  if (!["typesafe/jev-1.13", "typesafe/jev-1.14"].includes(model))
    throw new AccountSettingsError("Choose a pinned Jev model.");
  const parsed = z
    .object({
      data: z.object({
        id: z.string(),
        endpoints: z.array(
          z.object({
            provider_name: z.string(),
            status: z.number(),
            pricing: z
              .object({
                prompt: z.string().regex(/^(?:0|[1-9]\d*)(?:\.\d+)?$/),
                completion: z.string().regex(/^(?:0|[1-9]\d*)(?:\.\d+)?$/),
                request: z
                  .string()
                  .regex(/^(?:0|[1-9]\d*)(?:\.\d+)?$/)
                  .optional(),
                discount: z.number().optional(),
              })
              .strict(),
          }),
        ),
      }),
    })
    .parse(
      await metadata(`https://openrouter.ai/api/v1/models/${model}/endpoints`),
    );
  const endpoints = parsed.data.endpoints.filter(
    (e) => e.provider_name === "TypeSafe" && e.status === 0,
  );
  if (parsed.data.id !== model || !endpoints.length)
    throw new AccountSettingsError("Pinned Jev endpoint is unavailable.");
  const prices = endpoints.map((e) => ({
    inputUSDPerToken: Number(e.pricing.prompt),
    outputUSDPerToken: Number(e.pricing.completion),
    requestUSD:
      e.pricing.request === undefined ? null : Number(e.pricing.request),
  }));
  if (
    prices.some(
      (p) =>
        !Number.isFinite(p.inputUSDPerToken) ||
        p.inputUSDPerToken < 0 ||
        !Number.isFinite(p.outputUSDPerToken) ||
        p.outputUSDPerToken < 0 ||
        (p.requestUSD !== null &&
          (!Number.isFinite(p.requestUSD) || p.requestUSD < 0)),
    )
  )
    throw new AccountSettingsError("Jev pricing metadata is invalid.");
  return prices;
}
type Selection = {
  connectionId: string;
  credentialVersion: string;
  settingsRevision: string;
  model: string;
};
function selection(secret: ProviderSecret): Selection {
  if (
    typeof secret.jevConnectionId !== "string" ||
    typeof secret.jevCredentialVersion !== "string" ||
    typeof secret.jevSettingsRevision !== "string" ||
    typeof secret.model !== "string"
  )
    throw new AccountSettingsError("Select a Jev key and model first.");
  return {
    connectionId: secret.jevConnectionId,
    credentialVersion: secret.jevCredentialVersion,
    settingsRevision: secret.jevSettingsRevision,
    model: secret.model,
  };
}
export type JevBudgetCheck = {
  id: "default";
  checkedAt: string;
  selection: Selection;
  controls: KeyControls;
  assessment: ReturnType<typeof assessKeyControls>;
  prices: Awaited<ReturnType<typeof readJevPrice>>;
  digest: string;
};
function digest(controls: KeyControls, prices: JevBudgetCheck["prices"]) {
  return hash(
    JSON.stringify({
      limit: controls.limitUSD,
      reset: controls.reset,
      byok: controls.includeBYOK,
      management: controls.management,
      expiry: controls.expiresAt,
      budgets: controls.budgets.map((b) => ({
        scope: b.scope,
        limit: b.limit_usd,
        reset: b.reset_interval,
        byok: b.include_byok,
      })),
      prices,
    }),
  );
}
async function currentCheck(workspace: string) {
  const secret = await secretFor(workspace, "jev");
  if (!secret?.token)
    throw new AccountSettingsError("Select a Jev key and model first.");
  const before = selection(secret);
  const [controls, prices] = await Promise.all([
    readOpenRouterKeyControls(secret.token),
    readJevPrice(before.model),
  ]);
  const after = await secretFor(workspace, "jev");
  if (!after || !same(selection(after), before))
    throw new AccountSettingsError(
      "Jev selection changed during verification.",
    );
  return {
    id: "default" as const,
    checkedAt: new Date().toISOString(),
    selection: before,
    controls,
    prices,
    assessment: assessKeyControls(controls),
    digest: digest(controls, prices),
  };
}
export async function verifyJevBudget(workspace: string) {
  const check = await currentCheck(workspace);
  await put(workspace, "jev_budget", check);
  return check;
}
export type JevValidationApproval = {
  id: "default";
  approvalId: string;
  purpose: "one_validation";
  gameId: string;
  approvedBy: string;
  approvedAt: string;
  expiresAt: string;
  status: "approved" | "reserved" | "consumed" | "revoked";
  selection: Selection;
  digest: string;
  maxKeyLimitUSD: number;
  acceptResidualRisk: true;
  target: ReturnType<typeof target>;
  recordingId?: string;
};
export const approvalInput = z
  .object({
    operation: z.literal("approve"),
    gameId: z.string().min(1).max(200),
    maxKeyLimitUSD: z.number().finite().positive().max(1e9),
    acceptResidualRisk: z.literal(true),
  })
  .strict();
export async function approveJevValidation(
  workspace: string,
  actor: string,
  input: z.infer<typeof approvalInput>,
) {
  input = approvalInput.parse(input);
  const game = await get<Game>(workspace, "game", input.gameId);
  if (!game) throw new AccountSettingsError("Game not found.");
  const old = await get<JevValidationApproval>(
    workspace,
    "jev_validation",
    "default",
  );
  if (old?.status === "reserved" || (await activePaidRecording(workspace)))
    throw new AccountSettingsError(
      "Wait for the previous validation to finish.",
    );
  const check = await verifyJevBudget(workspace);
  if (
    check.assessment.state !== "controls_observed" ||
    check.controls.limitUSD === null ||
    check.controls.limitUSD > input.maxKeyLimitUSD
  )
    throw new AccountSettingsError(
      "Verify a lifetime key limit at or below the reviewed allowance, before approval.",
    );
  const grant: JevValidationApproval = {
    id: "default",
    approvalId: id("approval"),
    purpose: "one_validation",
    gameId: input.gameId,
    approvedBy: actor,
    approvedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 10 * 60000).toISOString(),
    status: "approved",
    selection: check.selection,
    digest: check.digest,
    maxKeyLimitUSD: input.maxKeyLimitUSD,
    acceptResidualRisk: true,
    target: target(game),
  };
  const rows = await query(
    `INSERT INTO records(workspace_id,kind,id,body) VALUES($1,'jev_validation','default',$2::jsonb) ON CONFLICT(workspace_id,kind,id) DO UPDATE SET body=excluded.body,updated_at=now() WHERE $3::jsonb IS NOT NULL AND records.body=$3::jsonb RETURNING id`,
    [workspace, JSON.stringify(grant), old ? JSON.stringify(old) : null],
  );
  if (!rows.length)
    throw new AccountSettingsError(
      "Validation approval changed. Reload before retrying.",
    );
  return grant;
}
async function activePaidRecording(workspace: string) {
  return (
    (
      await query(
        `SELECT id FROM jobs WHERE workspace_id=$1 AND kind='recording' AND state IN ('queued','claimed') AND body->>'mode'='jev' LIMIT 1`,
        [workspace],
      )
    ).length > 0
  );
}
export async function revokeJevValidation(workspace: string) {
  await query(
    `UPDATE records SET body=jsonb_set(body,'{status}','"revoked"'),updated_at=now() WHERE workspace_id=$1 AND kind='jev_validation' AND id='default'`,
    [workspace],
  );
  return { revoked: true, dispatchedRequestsCannotBeRecalled: true };
}
export function approvalMatches(
  grant: JevValidationApproval | null | undefined,
  recording?: Recording,
  phase: "queue" | "claim" = "queue",
  now = Date.now(),
) {
  return (
    !!grant &&
    grant.purpose === "one_validation" &&
    grant.acceptResidualRisk === true &&
    Date.parse(grant.expiresAt) > now &&
    grant.status === (phase === "queue" ? "approved" : "reserved") &&
    !!recording &&
    grant.gameId === recording.gameId &&
    recording.paidApprovalId === grant.approvalId &&
    (phase === "queue" || grant.recordingId === recording.id) &&
    recording.maxActions === 1 &&
    recording.maxDurationSeconds === 30
  );
}
export const JEV_APPROVAL_REQUIRED =
  "Paid Jev runs are blocked without verified provider controls, an explicit one-run approval accepting residual exposure, and one-action limits. A key cap is not a guaranteed total spending cap.";
export async function paidJevAllowed(
  workspace: string,
  recording?: Recording,
  phase: "queue" | "claim" = "queue",
) {
  return approvalMatches(
    await get<JevValidationApproval>(workspace, "jev_validation", "default"),
    recording,
    phase,
  );
}
export async function prepareJevReservation(
  workspace: string,
  recording: Recording,
) {
  const grant = await get<JevValidationApproval>(
    workspace,
    "jev_validation",
    "default",
  );
  if (
    !approvalMatches(grant, recording) ||
    !(await targetMatches(workspace, grant!))
  )
    throw new AccountSettingsError(JEV_APPROVAL_REQUIRED);
  const check = await currentCheck(workspace);
  if (
    check.assessment.state !== "controls_observed" ||
    check.digest !== grant!.digest ||
    !same(check.selection, grant!.selection) ||
    (check.controls.limitUSD ?? Infinity) > grant!.maxKeyLimitUSD
  )
    throw new AccountSettingsError(
      "Provider controls, price, target or Jev selection changed. Verify and approve again.",
    );
  return { selection: check.selection, grant: grant! };
}
export async function reserveJevValidation(
  tx: <T = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ) => Promise<T[]>,
  workspace: string,
  recording: Recording,
  grant: JevValidationApproval,
) {
  const rows = await tx(
    `UPDATE records SET body=$3::jsonb,updated_at=now() WHERE workspace_id=$1 AND kind='jev_validation' AND id='default' AND body=$2::jsonb AND (body->>'expiresAt')::timestamptz>now() AND EXISTS(SELECT 1 FROM records g WHERE g.workspace_id=$1 AND g.kind='game' AND g.id=$4 AND g.body->>'url'=$5 AND g.body->'manifestSource'->>'sha256' IS NOT DISTINCT FROM $6::text AND coalesce(g.body->'networkPolicy','null'::jsonb)=$7::jsonb) AND NOT EXISTS(SELECT 1 FROM jobs WHERE workspace_id=$1 AND kind='recording' AND state IN ('queued','claimed') AND body->>'mode'='jev') RETURNING id`,
    [
      workspace,
      JSON.stringify(grant),
      JSON.stringify({
        ...grant,
        status: "reserved",
        recordingId: recording.id,
      }),
      recording.gameId,
      grant.target.url,
      grant.target.manifest,
      JSON.stringify(grant.target.network),
    ],
  );
  if (!rows.length)
    throw new AccountSettingsError(
      "Validation expired, changed, or a paid recording is active.",
    );
}
export async function consumeJevValidation(
  workspace: string,
  recording: Recording,
) {
  const grant = await get<JevValidationApproval>(
    workspace,
    "jev_validation",
    "default",
  );
  if (
    !approvalMatches(grant, recording, "claim") ||
    !(await targetMatches(workspace, grant!))
  )
    throw new AccountSettingsError(JEV_APPROVAL_REQUIRED);
  const check = await currentCheck(workspace);
  if (
    check.assessment.state !== "controls_observed" ||
    check.digest !== grant!.digest ||
    !same(check.selection, grant!.selection)
  )
    throw new AccountSettingsError(
      "Provider controls, price or Jev selection changed before dispatch.",
    );
  const rows = await query(
    `UPDATE records SET body=jsonb_set(body,'{status}','"consumed"'),updated_at=now() WHERE workspace_id=$1 AND kind='jev_validation' AND id='default' AND body=$2::jsonb AND (body->>'expiresAt')::timestamptz>now() AND EXISTS(SELECT 1 FROM jobs WHERE id=$3 AND workspace_id=$1 AND state='claimed' AND lease_until>now()) RETURNING id`,
    [workspace, JSON.stringify(grant), recording.id],
  );
  if (!rows.length)
    throw new AccountSettingsError(
      "Validation approval was consumed or revoked.",
    );
}

export async function assertJevDispatch(
  workspace: string,
  recording: Recording,
) {
  const rows = await query(
    `SELECT j.id FROM jobs j JOIN records a ON a.workspace_id=j.workspace_id AND a.kind='jev_validation' AND a.id='default' JOIN records g ON g.workspace_id=j.workspace_id AND g.kind='game' AND g.id=$4 WHERE j.id=$1 AND j.workspace_id=$2 AND j.state='claimed' AND j.lease_until>now() AND a.body->>'approvalId'=$3 AND a.body->>'recordingId'=$1 AND a.body->>'status'='consumed' AND (a.body->>'expiresAt')::timestamptz>now() AND g.body->>'url'=a.body->'target'->>'url' AND g.body->'manifestSource'->>'sha256' IS NOT DISTINCT FROM a.body->'target'->>'manifest' AND coalesce(g.body->'networkPolicy','null'::jsonb)=a.body->'target'->'network'`,
    [recording.id, workspace, recording.paidApprovalId, recording.gameId],
  );
  if (!rows.length)
    throw new AccountSettingsError(
      "Validation was revoked, expired, retargeted or lost its worker lease before dispatch.",
    );
}
/** Authorize one request just before provider dispatch; a lost response never retries the slot. */
export async function authorizeJevRequest(
  workspace: string,
  recordingId: string,
) {
  const recording = await get<Recording>(workspace, "recording", recordingId);
  const grant = await get<
    JevValidationApproval & { requestAuthorized?: boolean }
  >(workspace, "jev_validation", "default");
  if (
    !recording ||
    recording.mode !== "jev" ||
    !grant ||
    grant.status !== "consumed" ||
    grant.requestAuthorized ||
    grant.recordingId !== recordingId ||
    grant.approvalId !== recording.paidApprovalId ||
    recording.maxActions !== 1 ||
    !(await targetMatches(workspace, grant))
  )
    throw new AccountSettingsError(
      "No unused request slot for this validation.",
    );
  const check = await currentCheck(workspace);
  if (
    check.assessment.state !== "controls_observed" ||
    check.digest !== grant.digest ||
    !same(check.selection, grant.selection)
  )
    throw new AccountSettingsError(
      "Provider controls, price or selection changed before the request.",
    );
  const rows = await query(
    `UPDATE records a SET body=a.body || jsonb_build_object('requestAuthorized',true,'requestAuthorizedAt',now()),updated_at=now() WHERE a.workspace_id=$1 AND a.kind='jev_validation' AND a.id='default' AND a.body=$2::jsonb AND (a.body->>'expiresAt')::timestamptz>now() AND EXISTS(SELECT 1 FROM jobs j JOIN records g ON g.workspace_id=j.workspace_id AND g.kind='game' AND g.id=$4 WHERE j.id=$3 AND j.workspace_id=$1 AND j.state='claimed' AND j.lease_until>now() AND g.body->>'url'=a.body->'target'->>'url' AND g.body->'manifestSource'->>'sha256' IS NOT DISTINCT FROM a.body->'target'->>'manifest' AND coalesce(g.body->'networkPolicy','null'::jsonb)=a.body->'target'->'network') RETURNING a.id`,
    [workspace, JSON.stringify(grant), recordingId, recording.gameId],
  );
  if (!rows.length)
    throw new AccountSettingsError(
      "Request slot was revoked, expired, retargeted or already used.",
    );
  return { allowed: true, maxRequests: 1 };
}
