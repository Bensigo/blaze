"use client";

import { useCallback, useEffect, useState } from "react";

type Token = { id: string; name: string; createdAt: string; expiresAt: string };

export default function AccountSettings({ user }: { user: { name: string; email: string } | null; onSaved: () => Promise<void> | void }) {
  const [tokens, setTokens] = useState<Token[]>([]);
  const [name, setName] = useState("");
  const [issued, setIssued] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [maintenance, setMaintenance] = useState<{eventRetention: "enabled" | "disabled" | "invalid"; retentionDays: number | null; lastRun: {finishedAt: string; outcome: "succeeded" | "failed"} | null} | null>(null);
  const [maintenanceError, setMaintenanceError] = useState("");
  const load = useCallback(async () => {
    const response = await fetch("/api/agent/tokens", { cache: "no-store" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not load access tokens.");
    setTokens(data.tokens);
  }, []);
  useEffect(() => { void load().catch(e => setError(e.message)); }, [load]);
  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/maintenance/status", { cache: "no-store", signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error("Maintenance status is unavailable.");
      return response.json();
    }).then(setMaintenance).catch(e => { if (!controller.signal.aborted) setMaintenanceError(e instanceof Error ? e.message : "Maintenance status is unavailable."); });
    return () => controller.abort();
  }, []);
  async function copyToken() {
    try { await navigator.clipboard.writeText(issued); setCopied(true); setError(""); }
    catch { setError("Could not copy the token. Select and copy it manually."); }
  }
  async function change(method: "POST" | "DELETE", body: object) {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/agent/tokens", { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not update access.");
      if (method === "POST") { setIssued(data.token); setName(""); setCopied(false); }
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not update access."); }
    finally { setBusy(false); }
  }
  return <section className="account-settings">
    <h2>Maintenance</h2>
    {maintenanceError ? <p role="alert">{maintenanceError}</p> : maintenance ? <><p>Event retention: {maintenance.eventRetention === "enabled" ? `${maintenance.retentionDays} days` : maintenance.eventRetention === "invalid" ? "Invalid configuration" : "Not configured"}.</p><p>Last maintenance: {maintenance.lastRun ? `${maintenance.lastRun.outcome} · ${new Date(maintenance.lastRun.finishedAt).toLocaleString()}` : "No run recorded"}.</p></> : <p role="status">Loading maintenance status…</p>}
    <h2>Read-only agent access</h2>
    <p>Tokens grant read-only access to this workspace.</p>
    {user && <p className="muted">Signed in as {user.email}</p>}
    {error && <p className="error-text" role="alert">{error}</p>}
    <form onSubmit={e => { e.preventDefault(); void change("POST", { name: name.trim() }); }}>
      <label>Token name <input required maxLength={80} value={name} onChange={e => setName(e.target.value)} placeholder="e.g. My MCP client" /></label>{" "}
      <button className="button primary" disabled={busy || !name.trim()}>Create token</button>
    </form>
    {issued && <div className="data-note" role="status"><strong>Copy this token now. It will not be shown again.</strong><p className="agent-token"><code>{issued}</code></p><button className="button" onClick={() => void copyToken()}>{copied ? "Copied" : "Copy token"}</button> <button className="button" onClick={() => setIssued("")}>Dismiss</button></div>}
    <h3>Active tokens</h3>
    {tokens.length ? <ul>{tokens.map(token => <li key={token.id}>{token.name} · {new Date(token.createdAt).toLocaleDateString()} · Expires {new Date(token.expiresAt).toLocaleDateString()} {" "}<button className="button" disabled={busy} onClick={() => void change("DELETE", { id: token.id })}>Revoke</button></li>)}</ul> : <p className="muted">No active tokens.</p>}
    <details><summary>Connect an MCP client</summary>
    <p>Install Node 22+, clone Blaze and install dependencies. Configure your MCP host to run <code>npm run --silent mcp</code> from the Blaze project, with <code>BLAZE_URL</code> set to your HTTPS Blaze origin and <code>BLAZE_TOKEN</code> set to the token through your host’s secret settings. HTTP is supported only for localhost. Tokens expire after 90 days.</p>
    <p>Available tools: <code>games_list</code>, <code>analytics_report</code>, and <code>discovery_report</code>.</p></details>
  </section>;
}
