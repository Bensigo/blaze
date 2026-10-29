import type { ProviderSecret } from "./types";

export const socialProviders = ["x", "x_feedback", "youtube", "instagram", "tiktok"] as const;
export type SocialProvider = (typeof socialProviders)[number];
export interface SocialGrant {
  secret: ProviderSecret;
  accountId: string;
  accountName: string;
  scopes: string[];
  expiresAt?: number;
}
export interface SocialAdapter {
  provider: SocialProvider;
  requiredScopes: string[];
  configured(): boolean;
  setup: string;
  authorizationUrl(input: { state: string; challenge: string; redirectUri: string }): string;
  exchange(input: { code: string; verifier: string; redirectUri: string }): Promise<SocialGrant>;
  refresh(secret: ProviderSecret): Promise<SocialGrant>;
  revoke(secret: ProviderSecret): Promise<void>;
}
export function isSocialProvider(value: string): value is SocialProvider {
  return socialProviders.some((provider) => provider === value);
}
export async function socialJson(url: string, init: RequestInit = {}): Promise<any> {
  const response = await fetch(url, {
    ...init,
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`Provider authorization failed (HTTP ${response.status}). Reconnect the account.`);
  const text = await response.text();
  if (!text.trim()) return {};
  if (text.length > 262144) throw new Error("Provider authorization response exceeded its limit.");
  try { return JSON.parse(text); } catch { throw new Error("Provider returned an invalid authorization response."); }
}
export function verifiedScopes(granted: string[], required: string[]) {
  if (required.some((scope) => !granted.includes(scope)))
    throw new Error("The account did not grant all required publishing permissions. Reconnect and allow the requested permissions.");
  return granted;
}
