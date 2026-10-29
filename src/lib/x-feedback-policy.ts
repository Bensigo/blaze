import { randomUUID } from "node:crypto";
import { get, query } from "./db";
import { hash } from "./security";
import { HttpError } from "./http-error";

export const X_FEEDBACK_BUDGET_BLOCK =
  "X feedback is blocked: a current owner-reviewed total spending cap arrangement and explicit one-time approval are required.";
type Receipt = {
  id: string;
  nonce: string;
  owner: string;
  appBinding: string;
  payer: string;
  evidence: string;
  limitUsd: number;
  remainingUsd: number;
  prepaidBalanceUsd: number;
  cycleEnd: string;
  reviewedAt: string;
  expiresAt: string;
  gameId: string;
  accountId: string;
  identityAvailable: boolean;
  searchAvailable: boolean;
  autoRecharge: false;
  sharedAccountAcknowledged: true;
  residualRiskAccepted: true;
  revoked?: boolean;
  flight?: "identity" | "search";
  uncertain?: boolean;
};
function financiallyCovered(receipt: Receipt) {
  return (
    Number.isFinite(receipt.limitUsd) &&
    receipt.limitUsd >= 0.06 &&
    receipt.limitUsd <= 1000000 &&
    Number.isFinite(receipt.remainingUsd) &&
    receipt.remainingUsd >= 0.06 &&
    receipt.remainingUsd <= receipt.limitUsd &&
    Number.isFinite(receipt.prepaidBalanceUsd) &&
    receipt.prepaidBalanceUsd >= 0.06 &&
    receipt.prepaidBalanceUsd <= 1000000
  );
}
function binding() {
  const client = process.env.X_FEEDBACK_CLIENT_ID,
    secret = process.env.X_FEEDBACK_CLIENT_SECRET;
  return client && secret ? hash(`${client.length}:${client}${secret}`) : "";
}
export async function saveXControls(
  workspace: string,
  owner: string,
  input: any,
) {
  const now = Date.now(),
    expiry = Date.parse(input?.expiresAt),
    cycle = Date.parse(input?.cycleEnd);
  const validText = (s: unknown) =>
    typeof s === "string" && s.trim().length > 0 && s.length <= 200;
  if (
    !binding() ||
    !validText(input?.payer) ||
    !validText(input?.evidence) ||
    !validText(input?.gameId) ||
    !validText(input?.accountId) ||
    !Number.isFinite(input?.limitUsd) ||
    !Number.isFinite(input?.remainingUsd) ||
    !Number.isFinite(input?.prepaidBalanceUsd) ||
    input.limitUsd < 0.06 ||
    input.limitUsd > 1000000 ||
    input.remainingUsd < 0.06 ||
    input.remainingUsd > input.limitUsd ||
    input.prepaidBalanceUsd < 0.06 ||
    input.prepaidBalanceUsd > 1000000 ||
    !Number.isFinite(expiry) ||
    expiry <= now ||
    expiry > now + 3600000 ||
    !Number.isFinite(cycle) ||
    cycle <= now ||
    expiry > cycle ||
    input.autoRecharge !== false ||
    input.sharedAccountAcknowledged !== true ||
    input.residualRiskAccepted !== true ||
    input.approveIdentity !== true ||
    input.approveSearch !== true
  )
    throw new HttpError(
      400,
      "Review a prepaid balance and remaining cycle allowance of at least $0.06 each, and accept unknown residual exposure for one identity and one search. Expiry must be within one hour and the current billing cycle.",
    );
  const receipt: Receipt = {
    id: "current",
    nonce: randomUUID(),
    owner,
    appBinding: binding(),
    payer: input.payer.trim(),
    evidence: input.evidence.trim(),
    limitUsd: input.limitUsd,
    remainingUsd: input.remainingUsd,
    prepaidBalanceUsd: input.prepaidBalanceUsd,
    cycleEnd: new Date(cycle).toISOString(),
    reviewedAt: new Date(now).toISOString(),
    expiresAt: new Date(expiry).toISOString(),
    gameId: input.gameId.trim(),
    accountId: input.accountId.trim(),
    identityAvailable: true,
    searchAvailable: true,
    autoRecharge: false,
    sharedAccountAcknowledged: true,
    residualRiskAccepted: true,
  };
  const saved = await query(
    `INSERT INTO records(workspace_id,kind,id,body) VALUES($1,'x_feedback_controls','current',$2::jsonb) ON CONFLICT(workspace_id,kind,id) DO UPDATE SET body=excluded.body,updated_at=now() WHERE COALESCE(records.body->>'flight','')='' AND COALESCE(records.body->>'uncertain','false')='false' RETURNING id`,
    [workspace, JSON.stringify(receipt)],
  );
  if (!saved.length)
    throw new HttpError(
      409,
      "An X attempt is in flight or its charges are unresolved. Review and resolve it before replacing approval.",
    );
  return receipt;
}
export async function revokeXControls(workspace: string) {
  await query(
    `UPDATE records SET body=body || '{"revoked":true}'::jsonb,updated_at=now() WHERE workspace_id=$1 AND kind='x_feedback_controls' AND id='current'`,
    [workspace],
  );
}
export async function resolveXControls(workspace: string) {
  const rows = await query(
    `UPDATE records SET body=body || '{"uncertain":false,"revoked":true}'::jsonb,updated_at=now() WHERE workspace_id=$1 AND kind='x_feedback_controls' AND id='current' AND COALESCE(body->>'flight','')='' AND body->>'uncertain'='true' RETURNING id`,
    [workspace],
  );
  if (!rows.length)
    throw new HttpError(
      409,
      "There is no settled unresolved attempt to resolve.",
    );
}
export async function getXControls(workspace: string) {
  const receipt = await get<Receipt>(
    workspace,
    "x_feedback_controls",
    "current",
  );
  const valid =
    !!receipt &&
    financiallyCovered(receipt) &&
    !receipt.revoked &&
    !receipt.flight &&
    !receipt.uncertain &&
    !!binding() &&
    receipt.appBinding === binding() &&
    Date.parse(receipt.expiresAt) > Date.now() &&
    Date.parse(receipt.cycleEnd) > Date.now();
  return {
    status: valid
      ? ("owner_reviewed_not_api_verified" as const)
      : ("not_verified" as const),
    balance: valid ? ("owner_reviewed" as const) : ("not_checked" as const),
    cycleLimit: valid ? ("owner_reviewed" as const) : ("not_checked" as const),
    autoRecharge: valid
      ? ("owner_reviewed_off" as const)
      : ("not_checked" as const),
    residualExposure: "unknown" as const,
    attemptState: receipt?.flight
      ? ("in_flight" as const)
      : receipt?.uncertain
        ? ("unresolved" as const)
        : ("idle" as const),
    identityAvailable: valid && receipt.identityAvailable,
    searchAvailable: valid && receipt.searchAvailable,
    nextStep: receipt?.flight
      ? "An X attempt is in flight. A new approval is blocked."
      : receipt?.uncertain
        ? "Check X for settlement and charges, then explicitly resolve this attempt before a new approval."
        : valid
          ? "Owner reviewed the console controls; X has not verified them through an API. Overshoot and extra fees remain unknown."
          : "Review the X console controls and record a time-limited approval before a paid test.",
  };
}
export async function requireXFeedbackBudget(
  workspace: string,
  operation: "identity" | "search",
  context?: { gameId?: string; accountId?: string; nonce?: string },
  consume = false,
) {
  const current = await get<Receipt>(
    workspace,
    "x_feedback_controls",
    "current",
  );
  if (
    !current ||
    !financiallyCovered(current) ||
    !binding() ||
    current.appBinding !== binding() ||
    current.revoked ||
    current.uncertain ||
    (current.flight &&
      !(
        consume &&
        operation === "identity" &&
        current.flight === "identity"
      )) ||
    !(operation === "identity"
      ? current.identityAvailable
      : current.searchAvailable) ||
    (context?.nonce && current.nonce !== context.nonce) ||
    (context?.gameId && current.gameId !== context.gameId) ||
    (context?.accountId && current.accountId !== context.accountId)
  )
    throw new HttpError(403, X_FEEDBACK_BUDGET_BLOCK);
  if (consume) {
    const patch =
      operation === "identity"
        ? { identityAvailable: false, flight: "identity" }
        : { searchAvailable: false, flight: "search" };
    const rows = await query(
      `UPDATE records SET body=body || $3::jsonb,updated_at=now() WHERE workspace_id=$1 AND kind='x_feedback_controls' AND id='current' AND body=$2::jsonb AND (body->>'expiresAt')::timestamptz>now() AND (body->>'cycleEnd')::timestamptz>now() AND COALESCE(body->>'revoked','false')='false' RETURNING id`,
      [workspace, JSON.stringify(current), JSON.stringify(patch)],
    );
    if (!rows.length) throw new HttpError(403, X_FEEDBACK_BUDGET_BLOCK);
  } else if (
    Date.parse(current.expiresAt) <= Date.now() ||
    Date.parse(current.cycleEnd) <= Date.now()
  )
    throw new HttpError(403, X_FEEDBACK_BUDGET_BLOCK);
  return current.nonce;
}
export async function reserveXIdentity(workspace: string, nonce: string) {
  const rows = await query(
    `UPDATE records SET body=body || '{"flight":"identity"}'::jsonb,updated_at=now() WHERE workspace_id=$1 AND kind='x_feedback_controls' AND id='current' AND body->>'nonce'=$2 AND body->>'appBinding'=$3 AND body->>'identityAvailable'='true' AND COALESCE(body->>'flight','')='' AND COALESCE(body->>'uncertain','false')='false' AND COALESCE(body->>'revoked','false')='false' AND (body->>'expiresAt')::timestamptz>now() AND (body->>'cycleEnd')::timestamptz>now() RETURNING id`,
    [workspace, nonce, binding()],
  );
  if (!rows.length || !binding())
    throw new HttpError(403, X_FEEDBACK_BUDGET_BLOCK);
}
export async function finishXAttempt(
  workspace: string,
  nonce: string,
  operation: "identity" | "search",
  dispatched: boolean,
  settled: boolean,
) {
  await query(
    `UPDATE records SET body=(body - 'flight') || $4::jsonb,updated_at=now() WHERE workspace_id=$1 AND kind='x_feedback_controls' AND id='current' AND body->>'nonce'=$2 AND body->>'flight'=$3`,
    [
      workspace,
      nonce,
      operation,
      JSON.stringify({ uncertain: dispatched && !settled }),
    ],
  );
}

export async function matchesXApprovedAccount(
  workspace: string,
  nonce: string,
  accountId: string,
) {
  const receipt = await get<Receipt>(
    workspace,
    "x_feedback_controls",
    "current",
  );
  return (
    !!receipt &&
    receipt.nonce === nonce &&
    receipt.accountId === accountId &&
    receipt.appBinding === binding() &&
    Date.parse(receipt.expiresAt) > Date.now()
  );
}
