"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import type { XFeedbackFinding } from "@/lib/x-feedback";
import styles from "./x-feedback-panel.module.css";

type Feedback = {
  query: string;
  limit: number;
  spendCap: "not_enforced";
  providerControls: {
    status: "not_verified" | "owner_reviewed_not_api_verified";
    nextStep: string;
  };
  blocked: boolean;
  blockedReason: string;
  configured: boolean;
  identity: "connected" | "disconnected";
  needsReconnect: boolean;
  entitlement: "not_tested" | "available_for_this_request" | "partial";
  groups: {
    mentions: XFeedbackFinding[];
    reportedBugs: XFeedbackFinding[];
    featureRequests: XFeedbackFinding[];
  };
  returned?: number;
  saved?: number;
  limitations?: string;
};
type Props = { gameId: string; onUpdated: () => Promise<void>; demo?: boolean };

async function readJson(response: Response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new Error(
      typeof data.error === "string"
        ? data.error
        : "Request failed. Please try again.",
    );
  return data;
}

export default function XFeedbackPanel({
  gameId,
  onUpdated,
  demo = false,
}: Props) {
  const [data, setData] = useState<Feedback>();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [pending, setPending] = useState<"connect" | "search" | "">("");
  const [connectConsent, setConnectConsent] = useState(false);
  const [searchConsent, setSearchConsent] = useState(false);
  const endpoint = `/api/games/${encodeURIComponent(gameId)}/feedback`;
  const load = useCallback(
    async (signal: AbortSignal) => {
      setLoading(true);
      setError("");
      setData(undefined);
      try {
        setData(
          await readJson(await fetch(endpoint, { cache: "no-store", signal })),
        );
      } catch (err) {
        if (!signal.aborted)
          setError(
            err instanceof Error ? err.message : "Could not load X feedback.",
          );
      } finally {
        if (!signal.aborted) setLoading(false);
      }
    },
    [endpoint],
  );
  useEffect(() => {
    setConnectConsent(false);
    setSearchConsent(false);
    if (demo) {
      setData(undefined);
      setError("");
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [demo, load]);
  async function reviewControls(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setError("");
    try {
      await readJson(
        await fetch("/api/x-feedback-controls", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            gameId,
            payer: form.get("payer"),
            accountId: form.get("accountId"),
            evidence: form.get("evidence"),
            limitUsd: Number(form.get("limitUsd")),
            remainingUsd: Number(form.get("remainingUsd")),
            prepaidBalanceUsd: Number(form.get("prepaidBalanceUsd")),
            cycleEnd: new Date(String(form.get("cycleEnd"))).toISOString(),
            expiresAt: new Date(Date.now() + 30 * 60000).toISOString(),
            autoRecharge: false,
            sharedAccountAcknowledged: true,
            residualRiskAccepted: true,
            approveIdentity: true,
            approveSearch: true,
          }),
        }),
      );
      await load(new AbortController().signal);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save review.");
    }
  }
  async function resolveControls(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      await readJson(
        await fetch("/api/x-feedback-controls", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            resolve: true,
            reviewedChargesAndSettled: true,
          }),
        }),
      );
      await load(new AbortController().signal);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not resolve attempt.",
      );
    }
  }
  async function revokeControls() {
    try {
      await readJson(
        await fetch("/api/x-feedback-controls", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ revoke: true }),
        }),
      );
      await load(new AbortController().signal);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not revoke review.");
    }
  }
  async function connect() {
    if (!connectConsent || pending || demo || data?.blocked !== false) return;
    setPending("connect");
    setError("");
    try {
      const body = await readJson(
        await fetch("/api/social/x_feedback/connect", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ readOnlyConsent: true }),
        }),
      );
      const target = new URL(body.url);
      if (
        target.protocol !== "https:" ||
        target.hostname !== "x.com" ||
        target.pathname !== "/i/oauth2/authorize"
      )
        throw new Error("X authorization URL was invalid.");
      window.location.assign(target.toString());
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not start X authorization.",
      );
      setPending("");
    }
  }
  async function collect() {
    if (!searchConsent || pending || demo || data?.blocked !== false) return;
    setPending("search");
    setError("");
    setSearchConsent(false);
    try {
      const next: Feedback = await readJson(
        await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ confirmSearchAndCost: true }),
        }),
      );
      setData(next);
      try {
        await onUpdated();
      } catch {
        setError(
          "Feedback was saved, but Actions could not refresh. Reload to see the latest findings.",
        );
      }
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "X search failed. Check access and billing before retrying.",
      );
    } finally {
      setPending("");
    }
  }
  return (
    <section className={styles.panel} aria-labelledby="x-feedback-title">
      <div className={styles.heading}>
        <div>
          <h2 id="x-feedback-title">X feedback</h2>
          <p>
            Find recent discussion about this game. Review each match before
            acting.
          </p>
        </div>
        <span>Manual search</span>
      </div>
      {demo ? (
        <p className={styles.notice}>
          Example workspace: X connection and search are disabled. No live
          feedback is shown.
        </p>
      ) : (
        <>
          {loading && <p className={styles.notice}>Loading saved feedback…</p>}
          {error && (
            <p className={styles.error} role="alert">
              {error}
            </p>
          )}
          {data && (
            <>
              <p className={styles.notice} role="status">
                <strong>
                  {data.providerControls.status === "not_verified"
                    ? "Paid X verification is blocked."
                    : "Owner reviewed; not API-verified."}
                </strong>{" "}
                The total charge is not guaranteed; overshoot and extra fees are
                unknown. {data.providerControls.nextStep}
              </p>
              <details className={styles.actionBlock}>
                <summary>Review X spending controls</summary>
                <p>
                  Review the X Developer Console first. This records your
                  review; Blaze cannot verify these settings. X can overshoot
                  and extra fees are unknown, so this is not a guaranteed total
                  cap. The $0.06 reference for one identity and ten posts
                  excludes unknown extra charges. Approval expires in 30 minutes
                  and permits at most one identity attempt and one search for
                  this game.
                </p>
                <form onSubmit={reviewControls}>
                  <label>
                    Payer reference{" "}
                    <input name="payer" required maxLength={200} />
                  </label>
                  <label>
                    X account ID{" "}
                    <input name="accountId" required maxLength={200} />
                  </label>
                  <label>
                    Evidence reference{" "}
                    <input name="evidence" required maxLength={200} />
                  </label>
                  <label>
                    Billing-cycle limit USD{" "}
                    <input
                      name="limitUsd"
                      type="number"
                      min="0.01"
                      step="0.01"
                      required
                    />
                  </label>
                  <label>
                    Remaining cycle allowance USD{" "}
                    <input
                      name="remainingUsd"
                      type="number"
                      min="0.01"
                      step="0.01"
                      required
                    />
                  </label>
                  <label>
                    Prepaid credit balance USD{" "}
                    <input
                      name="prepaidBalanceUsd"
                      type="number"
                      min="0.06"
                      step="0.01"
                      required
                    />
                  </label>
                  <label>
                    Cycle end{" "}
                    <input name="cycleEnd" type="datetime-local" required />
                  </label>
                  <label className={styles.check}>
                    <input type="checkbox" required />{" "}
                    <span>
                      I reviewed that auto-recharge is off and considered all
                      other account users.
                    </span>
                  </label>
                  <label className={styles.check}>
                    <input type="checkbox" required />{" "}
                    <span>
                      I accept unknown overshoot and extra fees and approve one
                      identity attempt and one search.
                    </span>
                  </label>
                  <button className={styles.button} type="submit">
                    Record review and approval
                  </button>
                </form>
                <button
                  className={styles.button}
                  type="button"
                  onClick={() => void revokeControls()}
                >
                  Revoke approval
                </button>
                <form onSubmit={resolveControls}>
                  <label className={styles.check}>
                    <input type="checkbox" required />{" "}
                    <span>
                      I checked X and confirmed the failed or ambiguous request
                      has settled and reviewed its charges.
                    </span>
                  </label>
                  <button className={styles.button} type="submit">
                    Resolve uncertain attempt
                  </button>
                </form>
              </details>
              <div className={styles.statusRow}>
                <div>
                  <span>Read-only identity</span>
                  <strong>
                    {data.identity === "connected"
                      ? data.needsReconnect
                        ? "Reconnect required"
                        : "Connected"
                      : "Not connected"}
                  </strong>
                </div>
                <div>
                  <span>Search access</span>
                  <strong>
                    {data.entitlement === "available_for_this_request"
                      ? "Available for last request"
                      : data.entitlement === "partial"
                        ? "Last request was partial"
                        : "Not tested"}
                  </strong>
                </div>
              </div>
              <p className={styles.small}>
                A connected identity does not establish search access or
                available credits.
              </p>
              {!data.configured && (
                <p className={styles.notice}>
                  The separate X feedback app is not configured. Its client ID,
                  secret and callback must be set up before connecting. Search
                  access and billing still need review.
                </p>
              )}
              {(data.identity === "disconnected" || data.needsReconnect) && (
                <div className={styles.actionBlock}>
                  <h3>Connect read-only access</h3>
                  <p>
                    X will request <strong>tweet.read</strong> (posts the
                    account can view), <strong>users.read</strong> (accounts it
                    can view) and <strong>offline.access</strong> (stay
                    connected until revoked). These scopes can include protected
                    content the account can view. They do not include
                    publishing.
                  </p>
                  <p>
                    Connection verifies your identity with X. The identity
                    lookup may be billed; X currently lists user reads at $0.010
                    each. Check current rates and billing in the{" "}
                    <a
                      href="https://console.x.com/"
                      target="_blank"
                      rel="noreferrer"
                    >
                      X Developer Console
                    </a>
                    .
                  </p>
                  <label className={styles.check}>
                    <input
                      type="checkbox"
                      checked={connectConsent}
                      onChange={(e) => setConnectConsent(e.target.checked)}
                    />{" "}
                    <span>
                      I consent to these read-only scopes and the possible
                      identity lookup charge.
                    </span>
                  </label>
                  <button
                    type="button"
                    className={styles.button}
                    disabled={
                      data.blocked !== false ||
                      !data.configured ||
                      !connectConsent ||
                      !!pending
                    }
                    onClick={() => void connect()}
                  >
                    {pending === "connect"
                      ? "Connecting…"
                      : data.needsReconnect
                        ? "Reconnect X feedback"
                        : "Connect X feedback"}
                  </button>
                </div>
              )}
              <div className={styles.actionBlock}>
                <h3>Search recent posts</h3>
                <p>
                  Query: <code>{data.query}</code>. One request, up to{" "}
                  {data.limit} posts; no automatic searches or pagination.
                </p>
                <p>
                  X lists post reads at $0.005 each: up to $0.05 for 10 posts at
                  that reference rate, excluding other charges. This estimate is
                  not a total spending cap; other charges are unknown. Prices
                  and access can change; confirm them in the{" "}
                  <a
                    href="https://console.x.com/"
                    target="_blank"
                    rel="noreferrer"
                  >
                    X Developer Console
                  </a>
                  . A failed request may still be billed.
                </p>
                <label className={styles.check}>
                  <input
                    type="checkbox"
                    checked={searchConsent}
                    onChange={(e) => setSearchConsent(e.target.checked)}
                  />{" "}
                  <span>I approve this one search and its possible cost.</span>
                </label>
                <button
                  type="button"
                  className={styles.button}
                  disabled={
                    data.blocked !== false ||
                    !data.configured ||
                    data.identity !== "connected" ||
                    data.needsReconnect ||
                    !searchConsent ||
                    !!pending
                  }
                  onClick={() => void collect()}
                >
                  {pending === "search" ? "Searching…" : "Search X once"}
                </button>
                {data.returned !== undefined && (
                  <p className={styles.small}>
                    Last request returned {data.returned} posts; {data.saved}{" "}
                    new findings saved. {data.limitations}
                  </p>
                )}
              </div>
              <p className={styles.small}>
                Matches may be incomplete or irrelevant. Reported bugs are
                claims, not verified reproductions.
              </p>
              <div className={styles.groups}>
                <Group title="Mentions" rows={data.groups.mentions} />
                <Group title="Reported bugs" rows={data.groups.reportedBugs} />
                <Group
                  title="Feature requests"
                  rows={data.groups.featureRequests}
                />
              </div>
            </>
          )}
        </>
      )}
    </section>
  );
}
function Group({ title, rows }: { title: string; rows: XFeedbackFinding[] }) {
  return (
    <div className={styles.group}>
      <h3>
        {title} <span>{rows.length}</span>
      </h3>
      {rows.length ? (
        <ul>
          {rows.map((row) => (
            <li key={row.id}>
              <div className={styles.itemMeta}>
                <span>
                  {row.feedback.relevance === "direct"
                    ? "Game URL mentioned"
                    : "Possible relevance"}
                </span>
                <time dateTime={row.feedback.publishedAt}>
                  {new Date(row.feedback.publishedAt).toLocaleDateString(
                    undefined,
                    {
                      year: "numeric",
                      month: "short",
                      day: "numeric",
                      timeZone: "UTC",
                    },
                  )}{" "}
                  UTC
                </time>
              </div>
              <p>{row.detail}</p>
              <a href={row.evidence[0]?.url} target="_blank" rel="noreferrer">
                View X post ↗
              </a>
            </li>
          ))}
        </ul>
      ) : (
        <p className={styles.empty}>No saved {title.toLowerCase()}.</p>
      )}
    </div>
  );
}
