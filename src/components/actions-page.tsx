"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  Finding,
  Game,
  Measurement,
  Recording,
  ResearchRun,
} from "@/lib/types";
import type { ExecutionStatus } from "@/lib/execution-status";
import { toActionItem } from "@/lib/action-items";
import InfoHint from "./info-hint";
import JevBudgetControls from "./jev-budget-controls";
import XFeedbackPanel from "./x-feedback-panel";
import "./actions-page.css";

const when = (value?: string | null) =>
  value ? new Date(value).toLocaleString() : "None recorded";
const errors: Record<string, string> = {
  access_denied:
    "The provider rejected access. Check the key and selected model.",
  billing_required:
    "The provider requires credits or billing access. Check the provider account before retrying.",
  rate_limited: "The provider rate limited this review. Retry manually later.",
  provider_unavailable:
    "The provider or network was unavailable. No automatic retry was made.",
  selection_changed:
    "The selection changed or could not be checked before dispatch. Reload Account settings.",
  history_unavailable:
    "Same-game history could not be loaded. No model request was required for that step.",
  invalid_result:
    "The provider responded, but the result did not pass validation. No successful review is claimed.",
  not_configured: "Choose a provider and model in Account settings.",
  configuration_unavailable:
    "The saved configuration could not be resolved. Review Account settings.",
  request_limit: "The review reached its four-request limit.",
  request_failed:
    "The model request did not complete. Review provider access before retrying.",
};
interface Props {
  games: Game[];
  findings: Finding[];
  recordings: Recording[];
  measurements: Measurement[];
  runs: ResearchRun[];
  selectedGame: string;
  demo: boolean;
  onAction: (payload: Record<string, unknown>) => Promise<unknown>;
  onUpdated: () => Promise<void>;
  onMeasure: (finding: Finding) => void;
  onRecording: (id: string, at?: number) => void;
  onAccount: () => void;
  onGameChange: (id: string) => void;
}
export default function ActionsPage({
  games,
  findings,
  recordings,
  measurements,
  runs,
  selectedGame,
  demo,
  onAction,
  onUpdated,
  onMeasure,
  onRecording,
  onAccount,
  onGameChange,
}: Props) {
  const [gameId, setGameId] = useState(
      selectedGame === "all" ? "" : selectedGame,
    ),
    [status, setStatus] = useState<ExecutionStatus | null>(null),
    [statusError, setStatusError] = useState(""),
    [busy, setBusy] = useState(false),
    [allowAI, setAllowAI] = useState(false),
    [queuedValidation, setQueuedValidation] = useState(""),
    [filter, setFilter] = useState("active"),
    [notes, setNotes] = useState<Record<string, string>>({});
  const loadStatus = useCallback(
    async (signal?: AbortSignal) => {
      if (demo) return;
      try {
        const response = await fetch(
          `/api/execution${gameId ? `?gameId=${encodeURIComponent(gameId)}` : ""}`,
          { cache: "no-store", signal },
        );
        if (!response.ok)
          throw new Error(
            "Execution status is unavailable. Retry the status check.",
          );
        const data = await response.json();
        if (!signal?.aborted) {
          setStatus(data);
          setStatusError("");
        }
      } catch (error) {
        if (!signal?.aborted)
          setStatusError(
            error instanceof Error
              ? error.message
              : "Execution status unavailable.",
          );
      }
    },
    [gameId, demo],
  );
  useEffect(() => {
    const controller = new AbortController();
    void loadStatus(controller.signal);
    return () => controller.abort();
  }, [loadStatus]);
  useEffect(() => {
    if (!busy) return;
    const controller = new AbortController(),
      timer = setInterval(() => void loadStatus(controller.signal), 2500);
    return () => {
      clearInterval(timer);
      controller.abort();
    };
  }, [busy, loadStatus]);
  const items = useMemo(
    () =>
      findings
        .filter((f) => !gameId || f.gameId === gameId)
        .map((f) => toActionItem(f, measurements, recordings, games))
        .filter((item) =>
          filter === "all" || filter === "active"
            ? filter === "all" ||
              ["open", "in_progress"].includes(item.status) ||
              (item.status === "deferred" &&
                !!item.deferredUntil &&
                Date.parse(item.deferredUntil) <= Date.now())
            : item.status === filter,
        )
        .sort(
          (a, b) =>
            ({ high: 0, medium: 1, low: 2 })[a.priority] -
            { high: 0, medium: 1, low: 2 }[b.priority],
        ),
    [findings, measurements, recordings, games, gameId, filter],
  );
  async function run(ai: boolean) {
    if (!gameId || busy) return;
    setBusy(true);
    try {
      await onAction({ action: "run_research", gameId, confirmAIUsage: ai });
      await loadStatus();
    } finally {
      setBusy(false);
      setAllowAI(false);
    }
  }
  async function update(finding: Finding, next: Finding["status"]) {
    setBusy(true);
    try {
      await onAction({
        action: "update_finding",
        id: finding.id,
        gameId: finding.gameId,
        status: next,
        note: notes[finding.id],
        ...(next === "deferred"
          ? { deferredUntil: new Date(Date.now() + 7 * 86400000).toISOString() }
          : {}),
      });
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="actions-workspace">
      <div className="actions-toolbar">
        <label>
          Game for review
          <select
            aria-label="Game for Actions"
            value={gameId}
            onChange={(event) => {
              setGameId(event.target.value);
              onGameChange(event.target.value);
              setStatus(null);
              setAllowAI(false);
            }}
          >
            <option value="">All games · choose one to run</option>
            {games.map((game) => (
              <option key={game.id} value={game.id}>
                {game.title}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={() => void loadStatus()}
          disabled={demo || busy}
        >
          Refresh status
        </button>
      </div>
      <section className="actions-execution" aria-label="Execution status">
        <h2>What is running</h2>
        {statusError && (
          <p role="alert" className="error-text">
            {statusError}
          </p>
        )}
        {demo ? (
          <p>
            Example findings only. Live execution and provider access are not
            verified here.
          </p>
        ) : !status ? (
          <p role="status">Loading saved configuration and run history…</p>
        ) : (
          <>
            <div className="actions-status-summary">
              <p>
                <strong>AI review:</strong>{" "}
                {status.ai.lastRun?.status === "failed"
                  ? "failed"
                  : ["preparing", "running"].includes(
                        status.ai.lastRun?.status || "",
                      )
                    ? "review in progress"
                    : status.ai.lastSuccessAt
                      ? "completed review recorded"
                      : status.ai.model
                        ? "selection saved; no successful review recorded"
                        : "setup needed"}
              </p>
              <p>
                <strong>Background play:</strong>{" "}
                {status.worker.online
                  ? "worker heartbeat observed"
                  : "worker offline"}
              </p>
              <p>
                <strong>Game adapter:</strong>{" "}
                {status.jev.adapter === "unverified"
                  ? "unverified"
                  : "observed in an earlier run"}
              </p>
            </div>
            {status.ai.lastRun?.errorCode && (
              <p className="error-text" role="alert">
                {errors[status.ai.lastRun.errorCode] ||
                  "Review failed; inspect the execution details."}
              </p>
            )}
            <details className="actions-status-details">
              <summary>Saved settings, attempts and next steps</summary>
              <div className="actions-status-row">
                <div>
                  <h3>AI review</h3>
                  <strong>
                    {status.ai.model
                      ? `${status.ai.provider} · ${status.ai.model}`
                      : "No selection saved"}
                  </strong>
                  <p>
                    Access checked: {when(status.ai.validatedAt)} · Saved key:{" "}
                    {status.ai.credentialPresent ? "present" : "missing"}
                  </p>
                </div>
                <div>
                  <p>
                    Recorded attempt: {when(status.ai.lastAttemptAt)}
                    <InfoHint label="About recorded model attempts">
                      A dispatch marker is saved immediately before the request.
                      A crash can happen before it reaches the network. Earlier
                      runs may only have source coverage; missing tracking does
                      not prove no historical request happened.
                    </InfoHint>
                  </p>
                  <p>Successful review: {when(status.ai.lastSuccessAt)}</p>
                  {status.ai.lastRun && (
                    <p>
                      Latest tracked stage: {status.ai.lastRun.phase} ·{" "}
                      {status.ai.lastRun.status} ·{" "}
                      {status.ai.lastRun.dispatches} dispatches /{" "}
                      {status.ai.lastRun.responses} HTTP responses
                    </p>
                  )}
                  {status.ai.lastRun?.errorCode && (
                    <p className="error-text" role="alert">
                      {errors[status.ai.lastRun.errorCode] ||
                        "Review failed; inspect run history before retrying."}
                    </p>
                  )}
                  <p>{status.ai.nextStep}</p>
                  <button type="button" onClick={onAccount}>
                    Account settings
                  </button>
                </div>
              </div>
              <div className="actions-status-row">
                <div>
                  <h3>Research</h3>
                  <strong>
                    {status.research.status === "never_run"
                      ? "No review recorded"
                      : status.research.status === "partial"
                        ? "Finished with source gaps"
                        : status.research.status}
                  </strong>
                  <p>Last started: {when(status.research.lastStartedAt)}</p>
                  <p>Last finished: {when(status.research.lastFinishedAt)}</p>
                </div>
                <div>
                  {status.ai.savedAt && !status.research.sinceSelection && (
                    <p>
                      No recorded review since the current AI selection was
                      saved.
                    </p>
                  )}
                  <p>
                    {status.research.queued} queued/claimed jobs ·{" "}
                    {status.research.expiredLeases} expired leases
                  </p>
                  <p>
                    Daily public reviews use deterministic checks. Paid AI
                    interpretation requires an explicit bounded review.
                  </p>
                </div>
              </div>
              <div className="actions-status-row">
                <div>
                  <h3>Background play</h3>
                  <strong>
                    {status.worker.online
                      ? "Recent worker heartbeat"
                      : "Worker offline"}
                  </strong>
                  <p>Last heartbeat: {when(status.worker.lastHeartbeatAt)}</p>
                  <p>
                    Jev: {status.jev.model || "not selected"} · Saved key:{" "}
                    {status.jev.credentialPresent ? "present" : "missing"}
                  </p>
                </div>
                <div>
                  <p>
                    Adapter:{" "}
                    {status.jev.adapter === "observed_in_run"
                      ? "observed in an earlier synthetic run"
                      : "unverified"}
                  </p>
                  <p>
                    Last Jev run:{" "}
                    {status.jev.lastRun
                      ? `${status.jev.lastRun.status} · ${when(status.jev.lastRun.createdAt)}`
                      : "none recorded"}
                  </p>
                  <p>{status.jev.nextStep}</p>
                  <InfoHint label="Worker hosting and proof limits">
                    {status.worker.hosting} A manifest import does not prove a
                    state/action adapter. Synthetic play does not establish
                    human enjoyment. Game-side work remains a separate
                    integration.
                  </InfoHint>
                </div>
              </div>
            </details>
          </>
        )}
      </section>
      <section className="actions-run">
        <h2>Review this game</h2>
        <div className="actions-buttons">
          <button
            type="button"
            disabled={!gameId || demo || busy}
            onClick={() => void run(false)}
          >
            {busy ? "Review in progress…" : "Check public evidence"}
          </button>
          <label className="actions-consent">
            <input
              type="checkbox"
              checked={allowAI}
              onChange={(event) => setAllowAI(event.target.checked)}
              disabled={demo || busy}
            />
            Allow one AI review: provider charges apply; at most four requests,
            no automatic retry.
          </label>
          <button
            type="button"
            disabled={
              !gameId ||
              !allowAI ||
              demo ||
              busy ||
              !status?.ai.credentialPresent
            }
            onClick={() => void run(true)}
          >
            Run bounded AI review
          </button>
        </div>
        <details>
          <summary>Prepare a one-action Jev test</summary>
          <p>
            Requires a running isolated worker and a supported game adapter. At
            most one Jev request; forced actions may need none. The 30-second
            action window is not a dollar or total-job-time cap.
          </p>
          <JevBudgetControls
            status={status}
            gameId={gameId}
            disabled={demo || busy}
            onRefresh={loadStatus}
          />
          <button
            type="button"
            disabled={
              !gameId ||
              !status?.jev.credentialPresent ||
              status?.jev.validationApproval?.status !== "approved" ||
              status?.jev.validationApproval?.gameId !== gameId ||
              demo ||
              busy
            }
            onClick={async () => {
              setBusy(true);
              try {
                const result = await onAction({
                  action: "queue_recording",
                  gameId,
                  mode: "jev",
                  maxActions: 1,
                  maxDurationSeconds: 30,
                  confirmModelUsage: true,
                  paidApprovalId: status?.jev.validationApproval?.approvalId,
                });
                if (
                  result &&
                  typeof result === "object" &&
                  "recording" in result &&
                  result.recording &&
                  typeof result.recording === "object" &&
                  "id" in result.recording &&
                  typeof result.recording.id === "string"
                )
                  setQueuedValidation(result.recording.id);
                await loadStatus();
              } finally {
                setBusy(false);
              }
            }}
          >
            Queue approved one-action validation
          </button>
          {queuedValidation && (
            <p role="status">
              Queued validation ID: <code>{queuedValidation}</code>. Queuing
              does not start the worker. Use this exact ID for the single-target
              Docker worker.
            </p>
          )}
        </details>
      </section>
      <section>
        <div className="actions-list-head">
          <h2>
            Next actions <span>{items.length}</span>
          </h2>
          <label>
            Show
            <select
              aria-label="Action status filter"
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
            >
              <option value="active">Active and due</option>
              <option value="deferred">Deferred</option>
              <option value="dismissed">Dismissed</option>
              <option value="resolved">Resolved</option>
              <option value="all">All</option>
            </select>
          </label>
        </div>
        {!items.length ? (
          <p className="table-empty">
            No supported actions in this view. Review public evidence or collect
            feedback for a selected game.
          </p>
        ) : (
          items.map((item) => {
            const finding = findings.find((f) => f.id === item.id)!;
            return (
              <article className="action-item" key={item.id}>
                <div className="action-item-heading">
                  <div>
                    <p>
                      {games.find((g) => g.id === item.gameId)?.title || "Game"}{" "}
                      · {item.priority} priority ·{" "}
                      {item.effort === "unknown"
                        ? "effort needs estimate"
                        : `${item.effort} effort`}{" "}
                      · {item.status.replaceAll("_", " ")}
                    </p>
                    <h3>{item.title}</h3>
                  </div>
                  <span>Recorded {when(item.recordedAt)}</span>
                </div>
                <p className="action-next-step">{item.suggestion}</p>
                <p>
                  <strong>Observed:</strong> {item.observation}
                </p>
                <div className="action-evidence">
                  {item.evidence.map((e, index) =>
                    e.recordingId ? (
                      <button
                        type="button"
                        key={index}
                        onClick={() => onRecording(e.recordingId!, e.at)}
                      >
                        {e.label}
                        {e.at !== undefined ? ` · ${e.at.toFixed(1)}s` : ""}
                      </button>
                    ) : e.url ? (
                      <a
                        key={index}
                        href={e.url}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {e.label} ↗
                      </a>
                    ) : (
                      <span key={index}>{e.label}</span>
                    ),
                  )}
                </div>
                <details>
                  <summary>Why this action and what to measure</summary>
                  <dl>
                    <dt>Why suggested</dt>
                    <dd>{item.reason}</dd>
                    <dt>Expected impact · hypothesis</dt>
                    <dd>{item.impactHypothesis}</dd>
                    <dt>Why act now</dt>
                    <dd>{item.whyNow}</dd>
                    <dt>Check afterward</dt>
                    <dd>{item.checkMetric}</dd>
                  </dl>
                  <label>
                    Decision note
                    <textarea
                      aria-label={`Decision note for ${item.title}`}
                      maxLength={500}
                      value={notes[item.id] ?? item.decisionNote ?? ""}
                      onChange={(event) =>
                        setNotes({ ...notes, [item.id]: event.target.value })
                      }
                    />
                  </label>
                </details>
                {item.deferredUntil && (
                  <p>Deferred until {when(item.deferredUntil)}</p>
                )}
                {item.measurements.map((m) => (
                  <p className="action-outcome" key={m.id}>
                    <strong>Outcome:</strong>{" "}
                    {m.releaseContextStatus === "missing" ||
                    m.releaseContextStatus === "invalid"
                      ? "Release context needs correction before an outcome can be interpreted."
                      : m.outcome?.nextAction ||
                        "Release comparison recorded; its follow-up is not yet available."}
                  </p>
                ))}
                <div className="actions-buttons">
                  <button
                    type="button"
                    disabled={busy || demo}
                    onClick={() => void update(finding, "in_progress")}
                  >
                    Start
                  </button>
                  <button
                    type="button"
                    disabled={busy || demo}
                    onClick={() => void update(finding, "deferred")}
                  >
                    Defer 7 days
                  </button>
                  <button
                    type="button"
                    disabled={busy || demo}
                    onClick={() => void update(finding, "dismissed")}
                  >
                    Dismiss
                  </button>
                  <button
                    type="button"
                    disabled={busy || demo}
                    onClick={() => onMeasure(finding)}
                  >
                    Record change & track outcome
                  </button>
                  {["dismissed", "deferred", "resolved"].includes(
                    item.status,
                  ) && (
                    <button
                      type="button"
                      disabled={busy || demo}
                      onClick={() => void update(finding, "open")}
                    >
                      Reopen
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={busy || demo}
                    onClick={() => void update(finding, "resolved")}
                  >
                    Resolve
                  </button>
                </div>
              </article>
            );
          })
        )}
      </section>
      {gameId && (
        <XFeedbackPanel gameId={gameId} onUpdated={onUpdated} demo={demo} />
      )}
      <details className="actions-history">
        <summary>
          Research history and source coverage ·{" "}
          {runs.filter((run) => !gameId || run.gameId === gameId).length} runs
        </summary>
        {runs
          .filter((run) => !gameId || run.gameId === gameId)
          .map((run) => (
            <div key={run.id}>
              <h3>
                {games.find((game) => game.id === run.gameId)?.title || "Game"}{" "}
                · {run.status}
              </h3>
              <p>
                {when(run.startedAt)}
                {run.finishedAt ? ` → ${when(run.finishedAt)}` : ""}
              </p>
              {run.error && <p className="error-text">{run.error}</p>}
              <ul>
                {run.coverage.map((source, index) => (
                  <li key={index}>
                    <strong>
                      {source.source}: {source.status}
                    </strong>{" "}
                    — {source.detail}
                  </li>
                ))}
              </ul>
            </div>
          ))}
      </details>
    </div>
  );
}
