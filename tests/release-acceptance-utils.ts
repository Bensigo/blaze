import { realpath, stat } from "node:fs/promises";
import { resolve, relative, isAbsolute } from "node:path";

export const RELEASE_ORIGIN = "https://web-game-marketing.vercel.app";
export function releaseOrigin(value: string | undefined) {
  if (value !== RELEASE_ORIGIN) throw new Error("Use the exact production release origin.");
  return value;
}
export async function privateStatePath(input: string, workDirectory: string) {
  const work = await realpath(workDirectory), file = await realpath(resolve(input));
  const rel = relative(work, file);
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) throw new Error("Authentication state must be inside the ignored work directory.");
  const metadata = await stat(file);
  if (!metadata.isFile() || (metadata.mode & 0o077) !== 0) throw new Error("Authentication state must be a private 0600 file.");
  return file;
}
