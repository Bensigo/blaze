"use client";

import { Check, ChevronsUpDown, Pencil, Plus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import "./workspace-switcher.css";

type Workspace = { id: string; name: string; home: boolean; active: boolean };
type Form = { mode: "create" } | { mode: "rename"; id: string };

/** The sidebar's workspace block: shows the active workspace and opens a list to switch, add or rename. */
export default function WorkspaceSwitcher({ name, demo }: { name: string; demo: boolean }) {
  const [open, setOpen] = useState(false);
  const [list, setList] = useState<Workspace[] | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    let live = true;
    fetch("/api/workspaces", { cache: "no-store" })
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Workspaces could not be loaded.");
        if (live) setList(data.workspaces);
      })
      .catch((e: Error) => live && setError(e.message));
    const away = (event: MouseEvent) => {
      if (root.current && !root.current.contains(event.target as Node)) setOpen(false);
    };
    const key = (event: KeyboardEvent) => event.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", key);
    return () => {
      live = false;
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", key);
    };
  }, [open]);

  const avatar = <div className="workspace-avatar" aria-hidden="true">{name.slice(0, 1).toUpperCase() || "W"}</div>;
  if (demo)
    return (
      <div className="workspace-switch">
        {avatar}
        <div>
          <strong>{name}</strong>
          <span>Example workspace</span>
        </div>
      </div>
    );

  const send = async (body: object) => {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/workspaces", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "That didn't work. Try again.");
      // A fresh page: every view reloads in the workspace now active.
      window.location.assign("/app");
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };
  const active = list?.find((w) => w.active);

  return (
    <div className="workspace-menu-root" ref={root}>
      <button type="button" className="workspace-switch workspace-switch-button" aria-haspopup="true" aria-expanded={open} onClick={() => { setOpen(!open); setForm(null); setError(""); }}>
        {avatar}
        <div>
          <strong>{name}</strong>
          <span>Workspace</span>
        </div>
        <ChevronsUpDown size={15} aria-hidden="true" />
      </button>
      {open && (
        <div className="workspace-menu" role="dialog" aria-label="Workspaces">
          {!list && !error && <p className="workspace-menu-note" role="status">Loading…</p>}
          {list && (
            <ul>
              {list.map((w) => (
                <li key={w.id}>
                  <button type="button" disabled={busy || w.active} aria-current={w.active ? "true" : undefined} onClick={() => send({ action: "switch", id: w.id })}>
                    <span className="workspace-menu-name">{w.name}</span>
                    {w.active && <Check size={15} aria-label="Active" />}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {form ? (
            <form
              className="workspace-menu-form"
              onSubmit={(event) => {
                event.preventDefault();
                void send(form.mode === "create" ? { action: "create", name: draft } : { action: "rename", id: form.id, name: draft });
              }}
            >
              <label>
                <span>{form.mode === "create" ? "New workspace name" : "Workspace name"}</span>
                <input autoFocus maxLength={60} value={draft} onChange={(event) => setDraft(event.target.value)} />
              </label>
              <div className="workspace-menu-actions">
                <button type="button" className="button ghost" onClick={() => setForm(null)} disabled={busy}>Cancel</button>
                <button type="submit" className="button primary" disabled={busy || !draft.trim()}>{form.mode === "create" ? "Create" : "Save"}</button>
              </div>
            </form>
          ) : (
            list && (
              <div className="workspace-menu-tools">
                <button type="button" onClick={() => { setForm({ mode: "create" }); setDraft(""); }} disabled={busy || list.length >= 10}>
                  <Plus size={15} aria-hidden="true" /> New workspace
                </button>
                {active && (
                  <button type="button" onClick={() => { setForm({ mode: "rename", id: active.id }); setDraft(active.name); }} disabled={busy}>
                    <Pencil size={14} aria-hidden="true" /> Rename this workspace
                  </button>
                )}
              </div>
            )
          )}
          {error && <p className="workspace-menu-note error" role="alert">{error}</p>}
        </div>
      )}
    </div>
  );
}
