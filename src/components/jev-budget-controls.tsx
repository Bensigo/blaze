"use client";
import { useState } from "react";
import type { ExecutionStatus } from "@/lib/execution-status";
export default function JevBudgetControls({
  status,
  gameId,
  disabled,
  onRefresh,
}: {
  status: ExecutionStatus | null;
  gameId: string;
  disabled: boolean;
  onRefresh: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [risk, setRisk] = useState(false);
  async function send(operation: "verify" | "approve" | "revoke") {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/account/jev/budget", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          operation === "approve"
            ? {
                operation,
                gameId,
                maxKeyLimitUSD: status?.jev.budget?.controls.limitUSD,
                acceptResidualRisk: risk,
              }
            : { operation },
        ),
      });
      const data = await response.json();
      if (!response.ok)
        throw Error(data.error || "Budget review could not be saved.");
      await onRefresh();
      setRisk(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Budget review unavailable.");
    } finally {
      setBusy(false);
    }
  }
  const budget = status?.jev.budget,
    approval = status?.jev.validationApproval;
  return (
    <div className="jev-budget-controls">
      <p>
        OpenRouter can enforce a per-key lifetime credit limit. Check the
        selected key without running a model; this does not change its budget.
      </p>
      <button
        type="button"
        disabled={disabled || busy || !status?.jev.credentialPresent}
        onClick={() => void send("verify")}
      >
        Check OpenRouter budget controls
      </button>
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
      {budget && (
        <>
          <p>
            <strong>Provider controls:</strong>{" "}
            {budget.assessment.state.replaceAll("_", " ")} · checked{" "}
            {new Date(budget.checkedAt).toLocaleString()}
          </p>
          <p>
            Key limit:{" "}
            {budget.controls.limitUSD === null
              ? "unlimited / unknown"
              : `$${budget.controls.limitUSD}`}{" "}
            · Remaining:{" "}
            {budget.controls.remainingUSD === null
              ? "unknown"
              : `$${budget.controls.remainingUSD}`}{" "}
            · Reset:{" "}
            {budget.controls.reset === null
              ? "never"
              : budget.controls.reset || "unknown"}{" "}
            · BYOK included:{" "}
            {budget.controls.includeBYOK === true ? "yes" : "no / unknown"}
          </p>
          {budget.assessment.reasons.map((reason) => (
            <p key={reason}>{reason}</p>
          ))}
          <p className="error-text">
            {budget.assessment.residualExposure} This is not an exact
            total-spending guarantee.
          </p>
          <p>
            Observed input price:{" "}
            {budget.prices
              .map(
                (p) =>
                  `$${(p.inputUSDPerToken * 1000000).toLocaleString(undefined, { maximumFractionDigits: 6 })}/million tokens; output $${(p.outputUSDPerToken * 1000000).toLocaleString(undefined, { maximumFractionDigits: 6 })}/million; per-request extras ${p.requestUSD === null ? "not reported" : `$${p.requestUSD}`}`,
              )
              .join(" · ")}
          </p>
        </>
      )}
      <p>
        One validation permits at most one decision request and one action in a
        30-second action window. Input is limited to 8,000 UTF-16 state units
        and 16,384 request bytes; response is capped at 65,536 bytes. No smaller
        provider token cap has been verified. No retries or recurring approval.
      </p>
      <label className="actions-consent">
        <input
          type="checkbox"
          disabled={disabled||busy}
          checked={risk}
          onChange={(e) => setRisk(e.target.checked)}
        />
        I approve one serial controlled validation using the existing key
        ceiling shown above, accepting settlement overrun, other-caller,
        auto-recharge and fee exposure. This is not an exact total-dollar cap.
        No budget change or credit purchase is authorized.
      </label>
      <button
        type="button"
        disabled={
          disabled ||
          busy ||
          !gameId ||
          !risk ||
          budget?.assessment.state !== "controls_observed"
        }
        onClick={() => void send("approve")}
      >
        Approve one scoped validation
      </button>
      {approval && (
        <>
          <p>
            Approval: {approval.status} · expires{" "}
            {new Date(approval.expiresAt).toLocaleString()} · reviewed key limit
            ${approval.maxKeyLimitUSD}. Approval does not start the worker.
          </p>
          <button
            type="button"
            disabled={disabled || busy}
            onClick={() => void send("revoke")}
          >
            Revoke validation approval
          </button>
        </>
      )}
    </div>
  );
}
