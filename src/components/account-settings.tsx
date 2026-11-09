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
  const load = useCallback(async () => {
    const response = await fetch("/api/agent/tokens", { cache: "no-store" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not load access tokens.");
    setTokens(data.tokens);
  }, []);
  useEffect(() => { void load().catch(e => setError(e.message)); }, [load]);
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
    <h2>Read-only agent access</h2>
    <p>Create a token to let an external MCP client read games, analytics and discovery reports for this workspace. It cannot change workspace data.</p>
    {user && <p className="muted">Signed in as {user.email}</p>}
    {error && <p className="error-text" role="alert">{error}</p>}
    <form onSubmit={e => { e.preventDefault(); void change("POST", { name: name.trim() }); }}>
      <label>Token name <input required maxLength={80} value={name} onChange={e => setName(e.target.value)} placeholder="e.g. My MCP client" /></label>{" "}
      <button className="button primary" disabled={busy || !name.trim()}>Create token</button>
    </form>
    {issued && <div className="data-note" role="status"><strong>Copy this token now. It will not be shown again.</strong><p className="agent-token"><code>{issued}</code></p><button className="button" onClick={() => void copyToken()}>{copied ? "Copied" : "Copy token"}</button> <button className="button" onClick={() => setIssued("")}>Dismiss</button></div>}
    <h3>Active tokens</h3>
    {tokens.length ? <ul>{tokens.map(token => <li key={token.id}>{token.name} · {new Date(token.createdAt).toLocaleDateString()} · Expires {new Date(token.expiresAt).toLocaleDateString()} {" "}<button className="button" disabled={busy} onClick={() => void change("DELETE", { id: token.id })}>Revoke</button></li>)}</ul> : <p className="muted">No active tokens.</p>}
    <h3>Connect an MCP client</h3>
    <p>Install Node 22+, clone Blaze and install dependencies. Configure your MCP host to run <code>npm run --silent mcp</code> from the Blaze project, with <code>BLAZE_URL</code> set to your HTTPS Blaze origin and <code>BLAZE_TOKEN</code> set to the token through your host’s secret settings. HTTP is supported only for localhost. Tokens expire after 90 days.</p>
    <p>Available tools: <code>games_list</code>, <code>analytics_report</code>, and <code>discovery_report</code>.</p>
  </section>;
}
