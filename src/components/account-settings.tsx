"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import "./account-settings.css";

type Provider = "anthropic" | "openrouter";
type Credential = { id: string; provider: Provider; label: string; model?: string; checkedAt?: string };
type JevCredential = { id: string; label: string; checkedAt?: string };
type Settings = { provider: Provider; model: string; connectionId: string; validatedAt: string; legacy?: boolean };
type Model = { id: string; name: string; compatible: boolean; reason?: string; contextWindow?: number; supportsTools: boolean; supportsStructuredOutput: boolean };
type AccountData = { settings: Settings | null; credentials: Credential[]; jev: JevCredential[]; jevConnectionId?: string; jevModel?: string };
const NEW = "__new__";

async function request<T>(url: string, body?: object): Promise<T> {
  const response = await fetch(url, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : undefined);
  const data = await response.json();
  if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : "Something went wrong. Please try again.");
  return data as T;
}
const message = (error: unknown) => error instanceof Error ? error.message : "Something went wrong. Please try again.";

export default function AccountSettings({ user, onSaved }: { user: { name: string; email: string } | null; onSaved: () => Promise<void> | void }) {
  const [data, setData] = useState<AccountData | null>(null);
  const [provider, setProvider] = useState<Provider>("anthropic");
  const [connection, setConnection] = useState("");
  const [token, setToken] = useState("");
  const [workspaceId, setWorkspaceId] = useState("");
  const [model, setModel] = useState("");
  const [models, setModels] = useState<Model[] | null>(null);
  const [catalogueInfo, setCatalogueInfo] = useState("");
  const [loadingModels, setLoadingModels] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [loadError, setLoadError] = useState("");
  const [retrying, setRetrying] = useState(false);
  const [jevConnection, setJevConnection] = useState("");
  const [jevModel, setJevModel] = useState("");
  const [jevToken, setJevToken] = useState("");
  const [jevLabel, setJevLabel] = useState("");
  const [jevSaving, setJevSaving] = useState(false);
  const [jevError, setJevError] = useState("");
  const [jevStatus, setJevStatus] = useState("");
  const catalogueVersion = useRef(0);
  const invalidate = () => { catalogueVersion.current += 1; setModels(null); setCatalogueInfo(""); setLoadingModels(false); };
  const hydrate = useCallback((next: AccountData) => {
    setData(next);
    const p = next.settings?.provider || "anthropic";
    setProvider(p);
    const available = next.credentials.filter((item) => item.provider === p);
    setConnection(next.settings?.connectionId || (available.length === 1 ? available[0].id : available.length ? "" : NEW));
    setModel(next.settings?.model || "");
    setToken("");
    setWorkspaceId("");
    setJevConnection(next.jevConnectionId || "");
    setJevModel(next.jevModel || "");
    setJevToken("");
    setJevLabel("");
  }, []);
  const refresh = useCallback(async () => {
    const next = await request<AccountData>("/api/account/ai");
    hydrate(next);
  }, [hydrate]);
  useEffect(() => {
    let active = true;
    request<AccountData>("/api/account/ai").then((next) => { if (active) hydrate(next); }).catch((err) => { if (active) setLoadError(message(err)); });
    return () => { active = false; catalogueVersion.current += 1; };
  }, [hydrate]);
  async function retryLoad() {
    setRetrying(true); setLoadError("");
    try { await refresh(); } catch (err) { setLoadError(message(err)); }
    finally { setRetrying(false); }
  }
  const credentials = data?.credentials.filter((item) => item.provider === provider) || [];
  const keyReady = connection === NEW ? !!token.trim() : !!connection;
  const selectedModel = models?.find((item) => item.id === model);
  const canSave = keyReady && !!selectedModel?.compatible && !loadingModels && !saving;
  function changeProvider(next: Provider) {
    invalidate(); setProvider(next); setToken(""); setWorkspaceId(""); setModel(""); setError(""); setStatus("");
    const available = data?.credentials.filter((item) => item.provider === next) || [];
    setConnection(available.length === 1 ? available[0].id : available.length ? "" : NEW);
  }
  function changeConnection(next: string) { invalidate(); setConnection(next); setToken(""); setWorkspaceId(""); setError(""); setStatus(""); }
  async function loadModels() {
    const version = ++catalogueVersion.current;
    setModels(null); setCatalogueInfo(""); setError(""); setStatus(""); setLoadingModels(true);
    try {
      const result = await request<{ models: Model[]; fetchedAt: string; source: string }>("/api/account/models", { provider, ...(connection && connection !== NEW ? { connectionId: connection } : {}), ...(token.trim() ? { token: token.trim() } : {}), ...(provider === "anthropic" && workspaceId.trim() ? { workspaceId: workspaceId.trim() } : {}) });
      if (version !== catalogueVersion.current) return;
      setModels(result.models); setCatalogueInfo(`Loaded ${result.models.length} models from ${result.source}.`);
    } catch (err) { if (version === catalogueVersion.current) setError(message(err)); }
    finally { if (version === catalogueVersion.current) setLoadingModels(false); }
  }
  async function saveAI(event: FormEvent) {
    event.preventDefault(); if (!canSave) return;
    setSaving(true); setError(""); setStatus("");
    try {
      await request("/api/account/ai", { provider, model, ...(connection !== NEW ? { connectionId: connection } : { token: token.trim() }), ...(provider === "anthropic" && workspaceId.trim() ? { workspaceId: workspaceId.trim() } : {}) });
      setToken(""); invalidate();
      try { await refresh(); await onSaved(); setStatus("AI settings saved for this workspace."); }
      catch { setStatus("AI settings saved. Refresh the page to see the latest settings."); }
    } catch (err) { setError(message(err)); }
    finally { setSaving(false); }
  }
  async function saveJev(event: FormEvent) {
    event.preventDefault(); if (!jevConnection || !jevModel || (jevConnection === NEW && !jevToken.trim())) return;
    setJevSaving(true); setJevError(""); setJevStatus("");
    try {
      await request("/api/account/jev", { model: jevModel, ...(jevConnection !== NEW ? { connectionId: jevConnection } : {}), ...(jevToken.trim() ? { token: jevToken.trim() } : {}), ...(jevLabel.trim() ? { label: jevLabel.trim() } : {}) });
      setJevToken("");
      try {
        const next = await request<AccountData>("/api/account/ai");
        setData(next);
        setJevConnection(next.jevConnectionId || "");
        setJevModel(next.jevModel || "");
        setJevLabel("");
        await onSaved(); setJevStatus("Jev key saved for this workspace.");
      }
      catch { setJevStatus("Jev key saved. Refresh the page to see the latest settings."); }
    } catch (err) { setJevError(message(err)); }
    finally { setJevSaving(false); }
  }
  return <div className="account-settings">
    <header className="account-settings-heading"><h1>Account settings</h1><p>Settings apply to the current workspace.</p></header>
    <section className="account-settings-section" aria-labelledby="account-identity"><div><h2 id="account-identity">Account</h2><p>Signed-in identity</p></div><div className="account-settings-identity"><strong>{user?.name || "Account"}</strong><span>{user?.email || "Email unavailable"}</span></div></section>
    {loadError ? <div className="account-settings-load-error"><p className="account-settings-error" role="alert">{loadError}</p><button type="button" className="account-settings-secondary" onClick={retryLoad} disabled={retrying}>Retry</button></div> : !data ? <p role="status">Loading settings…</p> : <>
      <section className="account-settings-section" aria-labelledby="account-ai"><div><h2 id="account-ai">AI provider</h2><p>Choose the provider and model used in this workspace.</p>{data.settings && <p>Saved: {data.settings.provider === "anthropic" ? "Anthropic" : "OpenRouter"} · {data.settings.model}{data.settings.legacy ? " (legacy)" : ""}</p>}</div>
        <form className="account-settings-form" onSubmit={saveAI}>
          <label>Provider<select value={provider} onChange={(e) => changeProvider(e.target.value as Provider)} disabled={saving}><option value="anthropic">Anthropic</option><option value="openrouter">OpenRouter</option></select></label>
          <label>API key<select value={connection} onChange={(e) => changeConnection(e.target.value)} disabled={saving}><option value="" disabled>Select a key</option>{credentials.map((item) => <option value={item.id} key={item.id}>{item.label}</option>)}<option value={NEW}>Use a new key</option></select></label>
          {connection === NEW && <label>New API key<input type="password" autoComplete="off" value={token} onChange={(e) => { invalidate(); setToken(e.target.value); setError(""); setStatus(""); }} placeholder="Paste API key" disabled={saving} /><small>Keys are never displayed after saving.</small></label>}
          {provider === "anthropic" && <label>Anthropic workspace ID (optional)<input value={workspaceId} onChange={(e) => { invalidate(); setWorkspaceId(e.target.value); setError(""); setStatus(""); }} placeholder={connection !== NEW ? "Leave blank to keep the existing workspace ID" : "For keys with multiple workspaces"} disabled={saving} /><small>{connection !== NEW ? "Leave blank to preserve the saved workspace ID." : "Enter a workspace ID if your key needs one."}</small></label>}
          <div><button type="button" className="account-settings-secondary" onClick={loadModels} disabled={loadingModels || saving || (provider === "anthropic" && !keyReady)}>{loadingModels ? "Loading models…" : "Load models"}</button><p className="account-settings-hint">{provider === "openrouter" ? "OpenRouter models can be loaded without a key." : "Select or enter a key to load Anthropic models."} Loading lists model metadata only.</p></div>
          {catalogueInfo && <p className="account-settings-hint" role="status">{catalogueInfo}</p>}
          <label>Model<select value={model} onChange={(e) => { setModel(e.target.value); setError(""); setStatus(""); }} disabled={!models || saving}><option value="">Select a model</option>{model && !models?.some((item) => item.id === model) && <option value={model} disabled>{model} — {models ? "unavailable" : "saved — load models to verify"}</option>}{models?.map((item) => <option key={item.id} value={item.id} disabled={!item.compatible}>{item.name} ({item.id}){!item.compatible ? ` — ${item.reason || "Not compatible"}` : ""}</option>)}</select></label>
          <p className="account-settings-hint">Models must support text, tools and structured output. Listing access does not verify generation or quota.</p>
          {models && models.length > 0 && !models.some((item) => item.compatible) && <p className="account-settings-warning" role="status">No compatible models were returned.</p>}
          {models && model && (!selectedModel || !selectedModel.compatible) && <p className="account-settings-warning" role="status">The selected model is unavailable or incompatible. Choose a compatible model before saving.</p>}
          {models && models.length === 0 && <p className="account-settings-hint">No models were returned. Check the provider and key, then try again.</p>}
          {error && <p className="account-settings-error" role="alert">{error}</p>}{status && <p className="account-settings-success" role="status">{status}</p>}
          <div><button className="account-settings-primary" disabled={!canSave}>{saving ? "Saving…" : "Save AI settings"}</button></div>
        </form>
      </section>
      <section className="account-settings-section" aria-labelledby="account-jev"><div><h2 id="account-jev">Jev gameplay</h2><p>Choose an OpenRouter key and decision model for gameplay. This selection is separate from writing and research.</p></div>
        <form className="account-settings-form" onSubmit={saveJev}>
          <label>OpenRouter key<select value={jevConnection} onChange={(e) => { setJevConnection(e.target.value); setJevToken(""); setJevLabel(""); setJevError(""); setJevStatus(""); }} disabled={jevSaving}><option value="" disabled>Select a key</option>{data.jev.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}<option value={NEW}>Use a new key</option></select></label>
          {jevConnection === NEW && <label>New OpenRouter key<input type="password" autoComplete="off" value={jevToken} onChange={(e) => setJevToken(e.target.value)} placeholder={jevConnection === NEW ? "Paste API key" : "Leave blank to keep existing key"} disabled={jevSaving || !jevConnection} /><small>Keys are never displayed after saving.</small></label>}
          {jevConnection === NEW && <label>Key label (optional)<input value={jevLabel} onChange={(e) => setJevLabel(e.target.value)} placeholder="Jev key" disabled={jevSaving} /></label>}
          <label>Decision model<select value={jevModel} onChange={(e) => setJevModel(e.target.value)} disabled={jevSaving}><option value="">Select a model</option><option value="typesafe/jev-1.13">Jev 1.13</option><option value="typesafe/jev-1.14">Jev 1.14</option></select><small>Model availability and key access are checked on save. Gameplay has not been tested.</small></label>
          {jevError && <p className="account-settings-error" role="alert">{jevError}</p>}{jevStatus && <p className="account-settings-success" role="status">{jevStatus}</p>}
          <div><button className="account-settings-primary" disabled={jevSaving || !jevConnection || !jevModel || (jevConnection === NEW && !jevToken.trim())}>{jevSaving ? "Saving…" : "Save Jev key"}</button></div>
        </form>
      </section>
    </>}
  </div>;
}
