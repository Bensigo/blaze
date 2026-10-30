"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { GripVertical, MessageSquare, Paperclip, X } from "lucide-react";
import { ACTION_COLUMNS, columnForAction } from "@/lib/action-board";
import type { ActionItem } from "@/lib/action-items";
import type { Finding } from "@/lib/types";


type Props = {
  items: ActionItem[];
  scopeControl: ReactNode;
  findings: Finding[];
  gameNames: Record<string, string>;
  disabled: boolean;
  onAction: (payload: Record<string, unknown>) => Promise<unknown>;
  onUpdated: () => Promise<void>;
  onMeasure: (finding: Finding) => void;
  onRecording: (id: string, at?: number) => void;
};
type View = "board" | "deferred" | "dismissed";
const date = (value?: string) =>
  value ? new Date(value).toLocaleString() : "Not recorded";
const statusLabel = (status: Finding["status"]) =>
  ACTION_COLUMNS.find((c) => c.status === status)?.label ||
  (status === "deferred" ? "Deferred" : "Dismissed");

export default function ActionBoard({
  items: serverItems,
  scopeControl,
  findings: serverFindings,
  gameNames,
  disabled,
  onAction,
  onUpdated,
  onMeasure,
  onRecording,
}: Props) {
  const [view, setView] = useState<View>("board");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [leaveIntent, setLeaveIntent] = useState<(() => void) | null>(null);
  const [confirmed, setConfirmed] = useState<Record<string, Finding>>({});
  const dialog = useRef<HTMLDialogElement>(null);
  const boardTitle = useRef<HTMLHeadingElement>(null);
  const openButtons = useRef(new Map<string, HTMLButtonElement>());
  const moveSelects = useRef(new Map<string, HTMLSelectElement>());
  const focusAfterSave = useRef<string | null>(null);
  const failedSnapshot = useRef<Finding[] | null>(null);
  const refreshRequested = useRef(false);
  const keepEditing = useRef<HTMLButtonElement>(null);
  const findings = serverFindings.map(
    (finding) => confirmed[finding.id] || finding,
  );
  const items = serverItems.map((item) => {
    const finding = confirmed[item.id];
    return finding
      ? {
          ...item,
          title: finding.title,
          status: finding.status,
          deferredUntil: finding.deferredUntil,
          decisionNote: finding.decisionNote,
        }
      : item;
  });
  const selected = items.find((item) => item.id === selectedId);
  const selectedFinding = findings.find((item) => item.id === selectedId);
  const snapshotPending = Object.values(confirmed).some((record) => {
    const fresh = serverFindings.find((item) => item.id === record.id);
    return (
      !fresh?.updatedAt ||
      !record.updatedAt ||
      Date.parse(fresh.updatedAt) < Date.parse(record.updatedAt)
    );
  });
  const locked = disabled || !!pending;
  const dirty =
    !!selected &&
    drafts[selected.id] !== undefined &&
    drafts[selected.id] !== (selected.decisionNote || "");

  useEffect(() => {
    const element = dialog.current;
    if (selected && element && !element.open) element.showModal();
    if (!selected && element?.open) element.close();
  }, [selected]);
  useEffect(() => {
    if (!selectedId) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [selectedId]);
  useEffect(() => {
    if (leaveIntent) keepEditing.current?.focus();
  }, [leaveIntent]);
  // Acknowledged records bridge a failed snapshot refresh, then yield to newer data.
  useEffect(() => {
    setConfirmed((current) => {
      const next = { ...current };
      let changed = false;
      for (const [id, finding] of Object.entries(current)) {
        const fresh = serverFindings.find((item) => item.id === id);
        if (
          fresh?.updatedAt &&
          finding.updatedAt &&
          Date.parse(fresh.updatedAt) >= Date.parse(finding.updatedAt)
        ) {
          delete next[id];
          changed = true;
        }
      }
      return changed ? next : current;
    });
    if (
      refreshRequested.current &&
      failedSnapshot.current &&
      failedSnapshot.current !== serverFindings
    ) {
      refreshRequested.current = false;
      failedSnapshot.current = null;
      setError("");
      setMessage("Saved state refreshed. Any unsaved note is kept.");
    }
  }, [serverFindings]);
  useEffect(() => {
    const id = focusAfterSave.current;
    if (!id || pending || selectedId) return;
    focusAfterSave.current = null;
    const frame = requestAnimationFrame(() =>
      (
        moveSelects.current.get(id) ||
        openButtons.current.get(id) ||
        boardTitle.current
      )?.focus(),
    );
    return () => cancelAnimationFrame(frame);
  }, [confirmed, pending, selectedId, view]);

  function close() {
    const id = selectedId;
    setSelectedId(null);
    setLeaveIntent(null);
    requestAnimationFrame(() =>
      ((id && openButtons.current.get(id)) || boardTitle.current)?.focus(),
    );
  }
  function leave(intent: () => void) {
    if (pending) return;
    if (dirty) setLeaveIntent(() => intent);
    else intent();
  }
  function forgetDraft(id: string) {
    setDrafts((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });
  }
  async function refreshBoard() {
    refreshRequested.current = true;
    try {
      await onUpdated();
    } catch {
      setError("The refresh could not be confirmed. Your note is kept.");
    }
  }
  async function save(item: ActionItem, next?: Finding["status"]) {
    if (locked) return false;
    setPending(item.id);
    setError("");
    setMessage("");
    failedSnapshot.current = null;
    refreshRequested.current = false;
    try {
      const result = await onAction(
        next
          ? {
              action: "update_finding",
              id: item.id,
              gameId: item.gameId,
              status: next,
              ...(next === "deferred"
                ? {
                    deferredUntil: new Date(
                      Date.now() + 7 * 86400000,
                    ).toISOString(),
                  }
                : {}),
            }
          : {
              action: "save_finding_note",
              id: item.id,
              gameId: item.gameId,
              note: drafts[item.id] ?? item.decisionNote ?? "",
            },
      );
      const updated =
        result && typeof result === "object" && "finding" in result
          ? (result.finding as Finding | undefined)
          : undefined;
      if (
        !updated ||
        updated.id !== item.id ||
        updated.gameId !== item.gameId ||
        !["open", "in_progress", "resolved", "deferred", "dismissed"].includes(
          updated.status,
        )
      )
        throw new Error("Unconfirmed save");
      setConfirmed((current) => ({ ...current, [item.id]: updated }));
      if (next) {
        setView(
          next === "deferred"
            ? "deferred"
            : next === "dismissed"
              ? "dismissed"
              : "board",
        );
        focusAfterSave.current = item.id;
      }
      if (!next) forgetDraft(item.id);
      setMessage(
        next
          ? `${item.title} moved to ${statusLabel(next)}.`
          : "Decision note saved.",
      );
      return true;
    } catch {
      failedSnapshot.current = serverFindings;
      setError(
        "The save could not be confirmed. Your note is kept. Refresh to check the saved status before trying again.",
      );
      return false;
    } finally {
      setPending(null);
    }
  }
  const deferred = items.filter((item) => item.status === "deferred");
  const dismissed = items.filter((item) => item.status === "dismissed");

  function moveControl(item: ActionItem, detail = false) {
    return (
      <label className="kanban-move">
        Move to
        <select
          ref={(element) => {
            if (!detail) {
              if (element) moveSelects.current.set(item.id, element);
              else moveSelects.current.delete(item.id);
            }
          }}
          aria-label={`Move ${item.title}`}
          value={item.status}
          disabled={locked}
          onChange={(event) =>
            void save(item, event.target.value as Finding["status"])
          }
        >
          {!["open", "in_progress", "resolved"].includes(item.status) && (
            <option value={item.status} disabled>
              {statusLabel(item.status)}
            </option>
          )}
          {ACTION_COLUMNS.map((column) => (
            <option key={column.status} value={column.status}>
              {column.label}
            </option>
          ))}
        </select>
      </label>
    );
  }
  function card(item: ActionItem) {
    const due = item.status === "deferred" && columnForAction(item) === "open";
    return (
      <article
        key={item.id}
        className={`kanban-card${dragging === item.id ? " is-dragging" : ""}`}
        aria-busy={pending === item.id}
        draggable={!locked}
        onDragStart={(event) => {
          if (
            locked ||
            (event.target as HTMLElement).closest(
              "button,select,input,textarea,a",
            )
          ) {
            event.preventDefault();
            return;
          }
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData("text/plain", item.id);
          setDragging(item.id);
        }}
        onDragEnd={() => {
          setDragging(null);
          setOver(null);
        }}
      >
        <div className="kanban-card-meta">
          <span>{gameNames[item.gameId] || "Game"}</span>
          <span
            className="kanban-grip"
            aria-hidden="true"
            title="Drag to another column"
          >
            <GripVertical size={17} />
          </span>
        </div>
        <h4>
          <button
            type="button"
            data-card-open
            ref={(element) => {
              if (element) openButtons.current.set(item.id, element);
              else openButtons.current.delete(item.id);
            }}
            onClick={() => {
              setSelectedId(item.id);
              setLeaveIntent(null);
              setError("");
            }}
            aria-label={`Open action: ${item.title}`}
          >
            {item.title}
          </button>
        </h4>
        <p className="kanban-card-summary">{item.suggestion}</p>
        <div className="kanban-card-tags">
          <span className={`kanban-priority priority-${item.priority}`}>
            {item.priority} priority
          </span>
          {due && <span className="kanban-due">Deferred · due</span>}
          {item.status === "deferred" && !due && (
            <span>
              {item.deferredUntil
                ? `Until ${new Date(item.deferredUntil).toLocaleDateString()}`
                : "Deferred · no date"}
            </span>
          )}
        </div>
        <div className="kanban-card-foot">
          <span>
            <Paperclip size={13} aria-hidden="true" />
            {item.evidence.length}
            <span className="sr-only"> evidence references</span>
            {item.decisionNote && (
              <>
                <MessageSquare size={13} aria-hidden="true" />
                <span className="sr-only">Saved decision note</span>
              </>
            )}
          </span>
          {moveControl(item)}
        </div>
        {pending === item.id && <p className="kanban-saving">Saving…</p>}
      </article>
    );
  }
  return (
    <section className="action-board" aria-labelledby="action-board-title">
      <div className="kanban-heading">
        <div>
          <h2 id="action-board-title" ref={boardTitle} tabIndex={-1}>
            Action board <span>{items.length}</span>
          </h2>
        </div>
        <div className="kanban-controls">
          {scopeControl}
          <button
            type="button"
            disabled={!!pending}
            onClick={() => void refreshBoard()}
          >
            Refresh board
          </button>
        </div>
      </div>
      <div className="kanban-views" aria-label="Action views">
        {(
          [
            [
              "board",
              "Board",
              items.filter((item) => columnForAction(item) !== null).length,
            ],
            ["deferred", "Deferred", deferred.length],
            ["dismissed", "Dismissed", dismissed.length],
          ] as const
        ).map(([id, label, count]) => (
          <button
            type="button"
            key={id}
            aria-pressed={view === id}
            onClick={() => setView(id)}
          >
            {label} <span>{count}</span>
          </button>
        ))}
      </div>
      <div className="kanban-announcements" aria-live="polite" role="status">
        {pending ? "Saving action…" : message}
      </div>
      {error && (
        <p className="kanban-error" role="alert">
          {error}
        </p>
      )}
      {view === "board" ? (
        <>
          <nav className="kanban-jump" aria-label="Jump to column">
            {ACTION_COLUMNS.map((column) => (
              <a href={`#action-column-${column.status}`} key={column.status}>
                {column.label}
              </a>
            ))}
          </nav>
          <div className="kanban-columns" aria-label="Actions Kanban board">
            {ACTION_COLUMNS.map((column) => {
              const cards = items.filter(
                (item) => columnForAction(item) === column.status,
              );
              return (
                <section
                  id={`action-column-${column.status}`}
                  key={column.status}
                  aria-labelledby={`column-title-${column.status}`}
                  className={`kanban-column${over === column.status ? " is-over" : ""}`}
                  onDragOver={(event) => {
                    if (dragging && !locked) {
                      event.preventDefault();
                      event.dataTransfer.dropEffect = "move";
                      setOver(column.status);
                    }
                  }}
                  onDragLeave={(event) => {
                    if (
                      !(event.relatedTarget instanceof Node) ||
                      !event.currentTarget.contains(event.relatedTarget)
                    )
                      setOver(null);
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    const item = items.find(
                      (item) =>
                        item.id === dragging &&
                        item.id === event.dataTransfer.getData("text/plain"),
                    );
                    setDragging(null);
                    setOver(null);
                    if (item && item.status !== column.status)
                      void save(item, column.status);
                  }}
                >
                  <header>
                    <h3 id={`column-title-${column.status}`}>
                      <span
                        className={`kanban-dot dot-${column.status}`}
                        aria-hidden="true"
                      />
                      {column.label}
                    </h3>
                    <span
                      aria-label={`${cards.length} ${cards.length === 1 ? "action" : "actions"}`}
                    >
                      {cards.length}
                    </span>
                  </header>
                  <div className="kanban-stack">
                    {cards.length ? (
                      cards.map(card)
                    ) : (
                      <p className="kanban-empty">
                        {column.status === "resolved"
                          ? "Completed actions will appear here."
                          : "No actions here."}
                      </p>
                    )}
                  </div>
                </section>
              );
            })}
          </div>
        </>
      ) : (
        <section
          className="kanban-shelf"
          aria-label={`${view === "deferred" ? "Deferred" : "Dismissed"} actions`}
        >
          <p>
            {view === "deferred"
              ? "Deferred actions keep their dates. Due items also appear in To do."
              : "Dismissed actions stay here. Move one to To do to bring it back."}
          </p>
          <div>
            {(view === "deferred" ? deferred : dismissed).length ? (
              (view === "deferred" ? deferred : dismissed).map(card)
            ) : (
              <p className="kanban-empty">No {view} actions.</p>
            )}
          </div>
        </section>
      )}

      <dialog
        ref={dialog}
        className="action-detail"
        aria-labelledby="action-detail-title"
        onCancel={(event) => {
          event.preventDefault();
          leave(close);
        }}
        onClose={() => {
          if (selectedId) close();
        }}
        onClick={(event) => {
          if (event.target !== event.currentTarget) return;
          const rect = event.currentTarget.getBoundingClientRect();
          if (
            event.clientX < rect.left ||
            event.clientX > rect.right ||
            event.clientY < rect.top ||
            event.clientY > rect.bottom
          )
            leave(close);
        }}
      >
        {selected && selectedFinding && (
          <>
            <header className="action-detail-head">
              <div>
                <p>
                  {gameNames[selected.gameId] || "Game"} · {selected.priority}{" "}
                  priority
                </p>
                <h2 id="action-detail-title">{selectedFinding.title}</h2>
              </div>
              <button
                type="button"
                autoFocus
                className="action-detail-close"
                aria-label="Close action details"
                disabled={!!pending}
                onClick={() => leave(close)}
              >
                <X size={20} />
              </button>
            </header>
            <div className="action-detail-body">
              <div className="action-detail-state">
                {moveControl(selected, true)}
                <span>
                  {selected.effort === "unknown"
                    ? "Effort not estimated"
                    : `${selected.effort} effort`}
                </span>
              </div>
              {selected.deferredUntil && (
                <p>Deferred until {date(selected.deferredUntil)}</p>
              )}
              <section>
                <h3>Next step</h3>
                <p className="action-next-step">{selected.suggestion}</p>
              </section>
              <section>
                <h3>Observed</h3>
                <p>{selected.observation}</p>
                <p className="action-detail-muted">
                  Recorded {date(selected.recordedAt)}
                </p>
                <details className="action-source-record">
                  <summary>Full source observation</summary>
                  <p>{selectedFinding.detail}</p>
                  <p className="action-detail-muted">
                    Original record · {date(selectedFinding.createdAt)}
                  </p>
                  {selectedFinding.evidence.length > 0 && (
                    <ul>
                      {selectedFinding.evidence.map((e, index) => (
                        <li key={index}>
                          {e.label}
                          {e.url && <code>{e.url}</code>}
                          {e.recordingId && (
                            <span>
                              Recording {e.recordingId}
                              {e.at !== undefined ? ` · ${e.at}s` : ""}
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </details>
              </section>
              <section>
                <h3>
                  Evidence <span>{selected.evidence.length}</span>
                </h3>
                <div className="action-evidence">
                  {selected.evidence.length ? (
                    selected.evidence.map((e, index) =>
                      e.recordingId ? (
                        <button
                          type="button"
                          key={index}
                          onClick={() =>
                            leave(() => {
                              close();
                              onRecording(e.recordingId!, e.at);
                            })
                          }
                        >
                          {e.label}
                          {e.at !== undefined ? ` · ${e.at.toFixed(1)}s` : ""}
                        </button>
                      ) : e.url ? (
                        <a
                          href={e.url}
                          target="_blank"
                          rel="noreferrer"
                          key={index}
                        >
                          {e.label} ↗
                        </a>
                      ) : (
                        <span key={index}>{e.label}</span>
                      ),
                    )
                  ) : (
                    <p>No evidence reference recorded.</p>
                  )}
                </div>
              </section>
              <section className="action-detail-reason">
                <h3>Why this action</h3>
                <p>{selectedFinding.action?.reason || selected.reason}</p>
                <h4>Impact · hypothesis</h4>
                <p>
                  {selectedFinding.action?.impactHypothesis ||
                    selected.impactHypothesis}
                </p>
                <h4>Why now</h4>
                <p>{selectedFinding.action?.whyNow || selected.whyNow}</p>
                <h4>Check afterward</h4>
                <p>
                  {selectedFinding.action?.checkMetric || selected.checkMetric}
                </p>
              </section>
              <section>
                <h3>Decision note</h3>
                <label className="sr-only" htmlFor="action-decision-note">
                  Decision note for {selected.title}
                </label>
                <textarea
                  id="action-decision-note"
                  maxLength={500}
                  disabled={disabled || !!pending}
                  value={drafts[selected.id] ?? selected.decisionNote ?? ""}
                  onChange={(event) =>
                    setDrafts((current) => ({
                      ...current,
                      [selected.id]: event.target.value,
                    }))
                  }
                />
                <div className="action-note-footer">
                  <span>
                    {dirty ? "Unsaved note" : "Saved note"} ·{" "}
                    {
                      (drafts[selected.id] ?? selected.decisionNote ?? "")
                        .length
                    }
                    /500
                  </span>
                  <button
                    type="button"
                    disabled={locked || !dirty}
                    onClick={() => void save(selected)}
                  >
                    Save note
                  </button>
                </div>
              </section>
              <section>
                <h3>
                  Outcomes <span>{selected.measurements.length}</span>
                </h3>
                {selected.measurements.length ? (
                  selected.measurements.map((m) => (
                    <div className="action-outcome" key={m.id}>
                      <p>
                        <strong>
                          {m.release?.version || "Recorded comparison"}
                        </strong>{" "}
                        · {date(m.startedAt)}
                      </p>
                      {m.note && <p>{m.note}</p>}
                      <p>
                        {m.releaseContextStatus === "missing" ||
                        m.releaseContextStatus === "invalid"
                          ? "Release context needs correction before an outcome can be interpreted."
                          : m.outcome?.nextAction ||
                            "Release comparison recorded; its follow-up is not yet available."}
                      </p>
                    </div>
                  ))
                ) : (
                  <p>No outcome recorded yet.</p>
                )}
                <button
                  type="button"
                  disabled={locked}
                  onClick={() =>
                    leave(() => {
                      close();
                      onMeasure(selectedFinding);
                    })
                  }
                >
                  Record change & track outcome
                </button>
              </section>
              <section className="action-decision-history">
                <h3>Decision details</h3>
                <dl>
                  <dt>Current status</dt>
                  <dd>{statusLabel(selected.status)}</dd>
                  <dt>Last updated</dt>
                  <dd>{date(selectedFinding.updatedAt)}</dd>
                  {selectedFinding.resolvedAt && (
                    <>
                      <dt>Resolved</dt>
                      <dd>{date(selectedFinding.resolvedAt)}</dd>
                    </>
                  )}
                  {selected.deferredUntil && (
                    <>
                      <dt>Deferred until</dt>
                      <dd>{date(selected.deferredUntil)}</dd>
                    </>
                  )}
                </dl>
              </section>
              {error && (
                <p className="kanban-error" role="alert">
                  {error}
                  <button
                    type="button"
                    disabled={!!pending}
                    onClick={() => void refreshBoard()}
                  >
                    Refresh saved state
                  </button>
                </p>
              )}
              <p className="action-detail-message" role="status">
                {pending ? "Saving action…" : message}
              </p>
              {snapshotPending && !error && (
                <div className="action-refresh-pending" role="status">
                  <p>Saved on the server. Workspace refresh is pending.</p>
                  <button
                    type="button"
                    disabled={!!pending}
                    onClick={() => void refreshBoard()}
                  >
                    Refresh saved state
                  </button>
                </div>
              )}
              {leaveIntent && (
                <div className="action-unsaved" role="alert">
                  <p>Your note has unsaved changes.</p>
                  <div className="actions-buttons">
                    <button
                      ref={keepEditing}
                      type="button"
                      onClick={() => setLeaveIntent(null)}
                    >
                      Keep editing
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        forgetDraft(selected.id);
                        const intent = leaveIntent;
                        setLeaveIntent(null);
                        intent();
                      }}
                    >
                      Discard note & continue
                    </button>
                  </div>
                </div>
              )}
            </div>
            <footer className="action-detail-footer">
              <button
                type="button"
                disabled={locked}
                onClick={() => void save(selected, "deferred")}
              >
                Defer 7 days
              </button>
              <button
                type="button"
                disabled={locked || selected.status === "dismissed"}
                onClick={() => void save(selected, "dismissed")}
              >
                Dismiss
              </button>
              <button
                type="button"
                className="action-detail-done"
                disabled={locked}
                onClick={() =>
                  void save(
                    selected,
                    selected.status === "resolved" ? "open" : "resolved",
                  )
                }
              >
                {selected.status === "resolved" ? "Reopen" : "Mark done"}
              </button>
            </footer>
          </>
        )}
      </dialog>
    </section>
  );
}
