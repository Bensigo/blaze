import type { ProviderSecret } from "../types";
export function token(secret?: ProviderSecret): string {
  if (!secret?.token) throw new Error("Provider credential is missing");
  return secret.token;
}
export async function api(
  url: string,
  secret: ProviderSecret,
  init: RequestInit = {},
): Promise<any> {
  const response = await fetch(url, {
    ...init,
    redirect: "error",
    signal: AbortSignal.timeout(20000),
    headers: { Authorization: `Bearer ${token(secret)}`, ...init.headers },
  });
  if (!response.ok)
    throw new Error(`Provider request failed (HTTP ${response.status})`);
  if (response.status === 204) return {};
  const json = await response.json();
  if (json?.error?.code && json.error.code !== "ok")
    throw new Error(
      `Provider request failed (${String(json.error.code)
        .replace(/[^a-zA-Z0-9_]/g, "")
        .slice(0, 80)})`,
    );
  return json;
}
export const jsonHeaders = { "Content-Type": "application/json" };
