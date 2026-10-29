import { query, list, get } from "./db";
import { decrypt, encrypt, hash } from "./security";
import type { Connection, ProviderSecret } from "./types";
export async function saveSecret(
  workspace: string,
  connectionId: string,
  secret: ProviderSecret,
) {
  await query(
    `INSERT INTO credentials(workspace_id,provider,encrypted) VALUES($1,$2,$3) ON CONFLICT(workspace_id,provider) DO UPDATE SET encrypted=excluded.encrypted`,
    [workspace, connectionId, await encrypt(secret)],
  );
}
export async function secretFor(
  workspace: string,
  provider: string,
  accountId?: string,
): Promise<ProviderSecret | undefined> {
  if (provider === "jev") {
    if (accountId) return;
    const settings = await get<{connectionId:string;model:string;revision:string;credentialVersion:string}>(workspace, "jev_settings", "default");
    if (!settings?.revision || !['typesafe/jev-1.13','typesafe/jev-1.14'].includes(settings.model)) return;
    const connection = await get<Connection>(workspace, "connection", settings.connectionId);
    const row = (await query<{encrypted:string}>("SELECT encrypted FROM credentials WHERE workspace_id=$1 AND provider=$2", [workspace, settings.connectionId]))[0];
    if (!connection?.connected || connection.provider !== 'openrouter' || !row || `${connection.credentialVersion || 'legacy'}:${hash(row.encrypted)}` !== settings.credentialVersion) return;
    const secret = await secretForConnection(workspace, connection.id);
    if (!secret?.token) return;
    return {...secret, model:settings.model, jevSettingsRevision:settings.revision, jevCredentialVersion:settings.credentialVersion, jevConnectionId:settings.connectionId};
  }
  const connections = await list<Connection>(workspace, "connection");
  const candidates = connections.filter(
    (c) =>
      c.provider === provider &&
      c.connected &&
      (!accountId || c.accountId === accountId),
  );
  const conn = candidates[0];
  if (!conn) return;
  return secretForConnection(workspace, conn.id);
}

export async function secretForConnection(workspace: string, connectionId: string): Promise<ProviderSecret | undefined> {
  const conn = await get<Connection>(workspace, "connection", connectionId);
  if (!conn?.connected) return;
  const row = (
    await query<{ encrypted: string }>(
      "SELECT encrypted FROM credentials WHERE workspace_id=$1 AND provider=$2",
      [workspace, conn.id],
    )
  )[0];
  if (!row) return;
  const secret = await decrypt(row.encrypted);
  if (conn.authMethod === "oauth") {
    const { freshSocialSecret } = await import("./social-oauth");
    return freshSocialSecret(workspace, conn, secret);
  }
  return secret;
}
export async function researchSecrets(workspace: string) {
  const result: Record<string, ProviderSecret> = {};
  for (const p of [
    "jev",
    "anthropic",
    "x",
    "reddit",
    "brave",
    "search_console",
  ]) {
    const s = await secretFor(workspace, p);
    if (s) result[p] = s;
  }
  return result;
}
