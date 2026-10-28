import { query, list } from "./db";
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
  const connections = await list<Connection>(workspace, "connection");
  const conn = connections.find(
    (c) =>
      c.provider === provider &&
      c.connected &&
      (!accountId || c.accountId === accountId),
  );
  if (!conn) return;
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
