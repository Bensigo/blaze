import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
  createHmac,
} from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import type { ProviderSecret } from "./types";
let localKey: Promise<Buffer> | undefined;
async function key() {
  if (process.env.CREDENTIAL_KEY) {
    const value = Buffer.from(process.env.CREDENTIAL_KEY, "base64");
    if (value.length !== 32)
      throw new Error("CREDENTIAL_KEY must contain 32 base64-encoded bytes.");
    return value;
  }
  if (process.env.NODE_ENV === "production" || process.env.VERCEL)
    throw new Error("Credential encryption is not configured.");
  if (!localKey)
    localKey = (async () => {
      await mkdir(".data", { recursive: true });
      try {
        return await readFile(".data/credential-key");
      } catch {
        const value = randomBytes(32);
        await writeFile(".data/credential-key", value, {
          mode: 0o600,
          flag: "wx",
        });
        return value;
      }
    })();
  return localKey;
}
export const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export async function encrypt(value: ProviderSecret) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", await key(), iv);
  const data = Buffer.concat([
    cipher.update(JSON.stringify(value), "utf8"),
    cipher.final(),
  ]);
  return [iv, cipher.getAuthTag(), data]
    .map((x) => x.toString("base64"))
    .join(".");
}
export async function decrypt(value: string): Promise<ProviderSecret> {
  const [iv, tag, data] = value.split(".").map((x) => Buffer.from(x, "base64"));
  const cipher = createDecipheriv("aes-256-gcm", await key(), iv);
  cipher.setAuthTag(tag);
  return JSON.parse(
    Buffer.concat([cipher.update(data), cipher.final()]).toString(),
  );
}
export function constantEqual(a: string, b: string) {
  const x = Buffer.from(a),
    y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
export function bearer(request: Request, envName: string) {
  const expected = process.env[envName];
  return (
    !!expected &&
    constantEqual(
      request.headers.get("authorization") || "",
      `Bearer ${expected}`,
    )
  );
}
export function publicOrigin(request: Request) {
  const parsed = new URL(request.url);
  const host = request.headers.get("host");
  if (host && /^[a-zA-Z0-9.:[\]-]+$/.test(host))
    return `${parsed.protocol}//${host}`;
  return parsed.origin;
}
export function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  return (
    !!origin &&
    (origin === publicOrigin(request) || origin === new URL(request.url).origin)
  );
}
export async function signMedia(mediaId: string, expires: number) {
  return createHmac("sha256", await key())
    .update(`${mediaId}:${expires}`)
    .digest("hex");
}
export async function verifyMedia(
  mediaId: string,
  expires: number,
  signature: string,
) {
  return (
    Number.isFinite(expires) &&
    expires > Date.now() &&
    expires < Date.now() + 3_600_000 &&
    constantEqual(await signMedia(mediaId, expires), signature)
  );
}
