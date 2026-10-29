import { query } from "./db";
import type { JevBudgetCheck, JevValidationApproval } from "./jev-budget";
import { BOUNDED_WORKER_PROTOCOL } from "../../worker/recording-limits";
import type { ResearchRun, Recording } from "./types";

export interface ExecutionStatus {
  ai: {
    provider: string | null;
    model: string | null;
    savedAt: string | null;
    validatedAt: string | null;
    credentialPresent: boolean;
    lastAttemptAt: string | null;
    lastSuccessAt: string | null;
    lastRun: ResearchRun["ai"] | null;
    nextStep: string;
  };
  jev: {
    model: string | null;
    savedAt: string | null;
    validatedAt: string | null;
    credentialPresent: boolean;
    budget: Pick<
      JevBudgetCheck,
      "checkedAt" | "controls" | "assessment" | "prices"
    > | null;
    validationApproval: Pick<
      JevValidationApproval,
      "approvalId" | "gameId" | "status" | "expiresAt" | "maxKeyLimitUSD"
    > | null;
    lastRun: Pick<Recording, "id" | "status" | "createdAt" | "mode"> | null;
    adapter: "unverified" | "observed_in_run";
    nextStep: string;
  };
  worker: {
    online: boolean;
    oneActionCapable: boolean;
    lastHeartbeatAt: string | null;
    hosting: string;
  };
  research: {
    lastStartedAt: string | null;
    lastFinishedAt: string | null;
    status: string;
    sinceSelection: boolean;
    queued: number;
    expiredLeases: number;
  };
}
type ConfigRow = {
  kind: string;
  saved_at: string;
  provider: string | null;
  model: string | null;
  validated_at: string | null;
  credential_present: boolean;
  settings_body?: unknown;
};
export function projectExecutionStatus(
  configs: ConfigRow[],
  runs: ResearchRun[],
  recordings: Recording[],
  heartbeat: string | null,
  jobs: { queued: number; expired: number },
  now = Date.now(),
  protocol = "legacy",
): ExecutionStatus {
  // PostgreSQL's text timestamp format is not portable to Safari's Date parser.
  const iso = (value: string | null) => {
    if (!value) return null;
    const normalized = value.replace(" ", "T").replace(/([+-]\d{2})$/, "$1:00");
    return Number.isFinite(Date.parse(normalized))
      ? new Date(normalized).toISOString()
      : null;
  };
  configs = configs.map((row) => ({
    ...row,
    saved_at: iso(row.saved_at) || "",
    validated_at: iso(row.validated_at),
  }));
  heartbeat = iso(heartbeat);
  const ai = configs.find((row) => row.kind === "ai_settings"),
    jev = configs.find((row) => row.kind === "jev_settings");
  const ordered = [...runs].sort(
    (a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt),
  );
  const attempts = ordered
    .filter((run) => run.ai?.lastAttemptAt)
    .sort(
      (a, b) =>
        Date.parse(b.ai!.lastAttemptAt!) - Date.parse(a.ai!.lastAttemptAt!),
    );
  const successes = ordered
    .filter((run) => run.ai?.status === "succeeded" && run.ai.succeededAt)
    .sort(
      (a, b) => Date.parse(b.ai!.succeededAt!) - Date.parse(a.ai!.succeededAt!),
    );
  const budgetRow = configs.find((row) => row.kind === "jev_budget")
    ?.settings_body as JevBudgetCheck | undefined;
  const grant = configs.find((row) => row.kind === "jev_validation")
    ?.settings_body as JevValidationApproval | undefined;
  const savedJev = jev?.settings_body as
    | {
        connectionId?: string;
        model?: string;
        revision?: string;
        credentialVersion?: string;
      }
    | undefined;
  const freshBudget =
    !!budgetRow &&
    !!savedJev &&
    budgetRow.selection.connectionId === savedJev.connectionId &&
    budgetRow.selection.model === savedJev.model &&
    budgetRow.selection.settingsRevision === savedJev.revision &&
    budgetRow.selection.credentialVersion === savedJev.credentialVersion &&
    now - Date.parse(budgetRow.checkedAt) >= 0 &&
    now - Date.parse(budgetRow.checkedAt) < 15 * 60000;
  const budget = budgetRow
    ? {
        ...budgetRow,
        ...(!freshBudget
          ? {
              assessment: {
                ...budgetRow.assessment,
                state: "setup_required",
                providerEnforced: false,
                reasons: [
                  "Stored check is stale or the selected key/model changed. Check controls again.",
                ],
              },
            }
          : {}),
      }
    : undefined;
  const approval = grant && Date.parse(grant.expiresAt) > now ? grant : null;
  const latestReview = ordered.find(
    (run) => run.ai && run.ai.status !== "not_requested",
  );
  const latest = ordered[0],
    play = [...recordings]
      .filter((row) => row.mode === "jev")
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0];
  const online =
    !!heartbeat &&
    Number.isFinite(Date.parse(heartbeat)) &&
    now - Date.parse(heartbeat) >= 0 &&
    now - Date.parse(heartbeat) < 90000;
  const adapter = [...recordings]
    .filter((r) => r.mode === "jev" && r.targetProvenance !== "controlled_lab")
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0]
    ?.observations?.some((note) =>
      /^Trace v1: (jev|forced) selected /.test(note.text),
    )
    ? "observed_in_run"
    : "unverified";
  return {
    ai: {
      provider: ai?.provider || null,
      model: ai?.model || null,
      savedAt: ai?.saved_at || null,
      validatedAt: ai?.validated_at || null,
      credentialPresent: !!ai?.credential_present,
      lastAttemptAt: attempts[0]?.ai?.lastAttemptAt || null,
      lastSuccessAt: successes[0]?.ai?.succeededAt || null,
      lastRun: latestReview?.ai || null,
      nextStep: !ai
        ? "Choose and save an AI provider/model in Account settings."
        : !ai.credential_present
          ? "Reconnect the selected key in Account settings."
          : !attempts.length
            ? "Run a bounded AI review after approving its model usage. Saving settings only checks access."
            : "Review the last result and its evidence; a provider response alone is not a completed review.",
    },
    jev: {
      model: jev?.model || null,
      savedAt: jev?.saved_at || null,
      validatedAt: jev?.validated_at || null,
      credentialPresent: !!jev?.credential_present,
      budget: budget
        ? {
            checkedAt: budget.checkedAt,
            controls: budget.controls,
            assessment: budget.assessment,
            prices: budget.prices,
          }
        : null,
      validationApproval: approval
        ? {
            approvalId: approval.approvalId,
            gameId: approval.gameId,
            status: approval.status,
            expiresAt: approval.expiresAt,
            maxKeyLimitUSD: approval.maxKeyLimitUSD,
          }
        : null,
      lastRun: play
        ? {
            id: play.id,
            status: play.status,
            createdAt: play.createdAt,
            mode: play.mode,
          }
        : null,
      adapter,
      nextStep:
        !jev || !jev.credential_present
          ? "Select and verify OpenRouter Jev in Account settings."
          : !online
            ? "Worker is offline. Check provider controls and approve a scoped validation after reviewing residual exposure."
            : protocol !== BOUNDED_WORKER_PROTOCOL
              ? "Update the worker to the bounded-run protocol. This validation needs the current request-bound worker protocol."
              : "Check the selected key controls, review residual exposure, and approve one scoped validation. Provider controls are not an exact total-spend guarantee.",
    },
    worker: {
      online,
      oneActionCapable: online && protocol === BOUNDED_WORKER_PROTOCOL,
      lastHeartbeatAt: heartbeat,
      hosting:
        "No always-on worker host is established by this screen. A recent heartbeat only shows a worker was responding.",
    },
    research: {
      lastStartedAt: latest?.startedAt || null,
      lastFinishedAt: latest?.finishedAt || null,
      status: latest?.status || "never_run",
      sinceSelection:
        !!ai &&
        !!latest &&
        Date.parse(latest.startedAt) >= Date.parse(ai.saved_at),
      queued: jobs.queued,
      expiredLeases: jobs.expired,
    },
  };
}
/** Metadata only: never decrypt credentials or call providers from a status read. */
export async function executionStatus(workspace: string, gameId?: string) {
  const [config, runs, recordings, heartbeat, jobs] = await Promise.all([
    query<ConfigRow>(
      `SELECT s.kind,s.body AS settings_body,s.updated_at::text AS saved_at,s.body->>'provider' AS provider,s.body->>'model' AS model,
      coalesce(s.body->>'validatedAt',c.body->>'checkedAt') AS validated_at,
      coalesce((c.body->>'connected')::boolean,false) AND EXISTS(SELECT 1 FROM credentials k WHERE k.workspace_id=s.workspace_id AND k.provider=c.id) AS credential_present
      FROM records s LEFT JOIN records c ON c.workspace_id=s.workspace_id AND c.kind='connection' AND c.id=s.body->>'connectionId'
      WHERE s.workspace_id=$1 AND s.kind IN ('ai_settings','jev_settings','jev_budget','jev_validation')`,
      [workspace],
    ),
    query<{ body: ResearchRun }>(
      `SELECT body FROM records WHERE workspace_id=$1 AND kind='run' AND ($2::text IS NULL OR body->>'gameId'=$2) ORDER BY updated_at DESC LIMIT 100`,
      [workspace, gameId || null],
    ),
    query<{ body: Recording }>(
      `SELECT body FROM records WHERE workspace_id=$1 AND kind='recording' AND ($2::text IS NULL OR body->>'gameId'=$2) ORDER BY updated_at DESC LIMIT 50`,
      [workspace, gameId || null],
    ),
    query<{ at: string; protocol?: string }>(
      `SELECT updated_at::text AS at,body->>'protocol' AS protocol FROM jobs WHERE kind='worker_heartbeat' ORDER BY updated_at DESC LIMIT 1`,
    ),
    query<{ queued: number; expired: number }>(
      `SELECT count(*) FILTER(WHERE j.state IN ('queued','claimed'))::int AS queued,count(*) FILTER(WHERE j.state='claimed' AND j.lease_until<now())::int AS expired
      FROM jobs j LEFT JOIN records r ON r.workspace_id=j.workspace_id AND r.kind=j.kind AND r.id=j.id WHERE j.workspace_id=$1 AND ($2::text IS NULL OR coalesce(j.body->>'gameId',r.body->>'gameId')=$2)`,
      [workspace, gameId || null],
    ),
  ]);
  return projectExecutionStatus(
    config,
    runs.map((row) => row.body),
    recordings.map((row) => row.body),
    heartbeat[0]?.at || null,
    { queued: jobs[0]?.queued || 0, expired: jobs[0]?.expired || 0 },
    Date.now(),
    heartbeat[0]?.protocol || "legacy",
  );
}
