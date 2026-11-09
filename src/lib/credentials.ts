import { query, list, get } from "./db";
import { decrypt, encrypt } from "./security";
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
  if (provider !== "search_console") return;
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
  if (conn.provider !== "search_console" || conn.authMethod === "oauth") return;
  return secret;
}
