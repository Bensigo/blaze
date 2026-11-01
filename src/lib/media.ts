import {createHash} from "node:crypto";
import { mkdir, writeFile, readFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import {
  put as blobPut,
  get as blobGet,
  del as blobDelete,
} from "@vercel/blob";
import { id, put, get, query, remove } from "./db";
import { neonStorageConfigured, neonStorageSelected, neonPut, neonDelete, neonRead, neonDownloadUrl } from "./neon-storage";
const localStorageAllowed = () => process.env.NODE_ENV !== "production" && !process.env.VERCEL;
export const mediaStorageConfigured = () => neonStorageSelected() ? neonStorageConfigured() : !!process.env.BLOB_READ_WRITE_TOKEN?.trim() || localStorageAllowed();
function requireLocalStorage() {
  if (!localStorageAllowed()) throw new Error("Private media storage is not configured");
}
export interface MediaRecord {
  id: string;
  recordingId: string;
  clipId?: string;
  kind: string;
  contentType: string;
  size: number;
  location: string;
  backend: "blob" | "local" | "neon";
  createdAt: string;
  captureId?: string;
  sessionId?: string;
  sha256?: string;
  expiresAt?: string;
  deletedAt?: string;
}
export async function saveAsset(
  workspace: string,
  recordingId: string,
  kind: string,
  file: File,
  clipId?: string,
  capture?: Pick<MediaRecord, "captureId" | "sessionId" | "expiresAt">,
) {
  const bytes = Buffer.from(await file.arrayBuffer());
  const mid = id("media");
  const contentType = mediaContentType(kind, bytes);
  if (!contentType) throw new Error("Unsupported media data");
  if (neonStorageSelected() && !neonStorageConfigured()) throw new Error("Private Neon storage is not configured");
  const backend: "blob" | "local" | "neon" = neonStorageConfigured() ? "neon" : process.env.BLOB_READ_WRITE_TOKEN?.trim() ? "blob" : "local";
  if (backend === "local") requireLocalStorage();
  const storagePath = backend === "local" ? join(".data/media", workspace, mid) : `${workspace}/${mid}`;
  const intent = { id: mid, location: storagePath, backend, createdAt: new Date().toISOString(), cleanupAfter: new Date(Date.now() + 30 * 60000).toISOString() };
  await put(workspace, "media_storage_intent", intent);
  let location = storagePath;
  try {
    if (backend === "neon") await neonPut(storagePath, bytes, contentType);
    else if (backend === "blob") {
      const blob = await blobPut(storagePath, bytes, { access: "private", contentType, addRandomSuffix: false, allowOverwrite: false });
      location = blob.url;
    } else {
      await mkdir(join(".data/media", workspace), { recursive: true });
      await writeFile(location, bytes, { mode: 0o600, flag: "wx" });
    }
    await put<MediaRecord>(workspace, "media", { id: mid, recordingId, clipId, kind, contentType, size: bytes.length, location, backend, createdAt: new Date().toISOString(), ...capture, sha256:createHash("sha256").update(bytes).digest("hex") });
    await remove(workspace, "media_storage_intent", mid).catch(() => {});
  } catch (error) {
    try {
      if (backend === "neon") await neonDelete(storagePath);
      else if (backend === "blob") await blobDelete(storagePath);
      else try { await unlink(storagePath); } catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
      await remove(workspace, "media_storage_intent", mid);
    } catch { /* Intent remains durable for cleanup retry. */ }
    throw error;
  }
  return `/api/media/${mid}`;
}
export function mediaContentType(kind: string, bytes: Buffer) {
  let contentType = "";
  if (
    kind === "screenshot" &&
    bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    contentType = "image/png";
  if (
    (kind === "video" || kind === "session") &&
    bytes.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))
  )
    contentType = "video/webm";
  if (
    (kind === "clip" || kind === "session") &&
    bytes.subarray(4, 8).toString() === "ftyp"
  )
    contentType = "video/mp4";
  return contentType;
}
export async function mediaRecord(workspace: string, mid: string) {
  const record = await get<MediaRecord>(workspace, "media", mid);
  return record?.deletedAt ? undefined : record;
}
// Never overwrite a deletion tombstone when recovering an interrupted upload.
export async function registerMediaIfAbsent(workspace: string, record: MediaRecord) {
  await query(`INSERT INTO records(workspace_id,kind,id,body) VALUES($1,'media',$2,$3::jsonb) ON CONFLICT(workspace_id,kind,id) DO NOTHING`, [workspace, record.id, JSON.stringify(record)]);
  return mediaRecord(workspace, record.id);
}
export async function mediaBytes(record: MediaRecord) {
  if (record.deletedAt || (record.expiresAt && Date.parse(record.expiresAt) <= Date.now()))
    throw new Error("Media expired");
  if (record.backend === "local") { requireLocalStorage(); return readFile(record.location); }
  if (record.backend === "neon") {
    if (!await lookupMedia(record.id)) throw new Error("Media expired");
    if (!Number.isSafeInteger(record.size) || record.size <= 0 || record.size > 150 * 1024 * 1024) throw new Error("Media exceeds download limit");
    const result = await neonRead(record.location, `bytes=0-${record.size - 1}`);
    if (!result.Body || result.ContentLength !== record.size) throw new Error("Media unavailable or size mismatch");
    const chunks: Buffer[] = []; let length = 0;
    for await (const chunk of result.Body as AsyncIterable<Uint8Array>) {
      length += chunk.length;
      if (length > record.size) throw new Error("Media exceeds download limit");
      chunks.push(Buffer.from(chunk));
    }
    if (length !== record.size) throw new Error("Media size mismatch");
    return Buffer.concat(chunks, length);
  }
  const blob = await blobGet(record.location, { access: "private" });
  if (!blob || blob.statusCode !== 200) throw new Error("Media unavailable");
  return Buffer.from(await new Response(blob.stream).arrayBuffer());
}
export async function lookupMedia(mid: string) {
  return (
    await query<{ workspace_id: string; body: MediaRecord }>(
      `SELECT workspace_id,body FROM records WHERE kind='media' AND id=$1 AND NOT (body ? 'deletedAt')`,
      [mid],
    )
  )[0];
}
export async function serveMedia(record: MediaRecord, request: Request) {
  if (record.deletedAt || (record.expiresAt && Date.parse(record.expiresAt) <= Date.now()))
    return new Response(null, { status: 410 });
  if (record.captureId) {
    const grant = (
      await query<{ state: string }>(
        `SELECT g.state FROM session_capture_grants g WHERE g.capture_id=$1 AND NOT EXISTS (SELECT 1 FROM session_capture_grants withdrawn WHERE withdrawn.workspace_id=g.workspace_id AND withdrawn.game_id=g.game_id AND withdrawn.session_id=g.session_id AND withdrawn.state='cancelled')`,
        [record.captureId],
      )
    )[0];
    if (grant?.state !== "ready") return new Response(null, { status: 410 });
  }
  const range = request.headers.get("range");
  const headers: Record<string, string> = {
    "Content-Type": record.contentType,
    "Content-Length": String(record.size),
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
  };
  let start = 0,
    end = record.size - 1;
  if (range) {
    const match = /^bytes=(\d+)-(\d*)$/.exec(range);
    if (!match)
      return new Response(null, {
        status: 416,
        headers: { "Content-Range": `bytes */${record.size}` },
      });
    start = Number(match[1]);
    end = match[2]
      ? Math.min(Number(match[2]), record.size - 1)
      : record.size - 1;
    if (start > end || start >= record.size)
      return new Response(null, {
        status: 416,
        headers: { "Content-Range": `bytes */${record.size}` },
      });
    headers["Content-Length"] = String(end - start + 1);
    headers["Content-Range"] = `bytes ${start}-${end}/${record.size}`;
  }
  if (record.backend === "neon") {
    if (!await lookupMedia(record.id)) return new Response(null, { status: 410 });
    const path = new URL(request.url).pathname;
    const downloadName = path.includes("/manual-export/download") ? `game-clip.${record.contentType === "video/mp4" ? "mp4" : "webm"}` : /^\/api\/content-studio\/[^/]+\/download$/.test(path) ? "blaze-video.mp4" : undefined;
    return new Response(null, { status: 307, headers: { Location: await neonDownloadUrl(record.location, downloadName), "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" } });
  }
  if (record.backend === "blob") {
    const blob = await blobGet(record.location, {
      access: "private",
      headers: range ? { Range: `bytes=${start}-${end}` } : {},
    });
    if (!blob || blob.statusCode !== 200)
      return new Response(null, { status: 404 });
    if (
      range &&
      blob.headers.get("content-range") !==
        `bytes ${start}-${end}/${record.size}`
    ) {
      await blob.stream.cancel();
      return new Response(null, { status: 502 });
    }
    return new Response(blob.stream, { status: range ? 206 : 200, headers });
  }
  requireLocalStorage();
  const bytes = await readFile(record.location);
  return new Response(new Uint8Array(bytes.subarray(start, end + 1)), {
    status: range ? 206 : 200,
    headers,
  });
}
export async function deleteAsset(
  workspace: string,
  url: string,
  captureId?: string,
) {
  const mid = /^\/api\/media\/(media_[a-z0-9]+)$/.exec(url)?.[1];
  if (!mid) throw new Error("Invalid private media reference");
  let record = await get<MediaRecord>(workspace, "media", mid);
  if (!record) return;
  if (captureId && record.captureId !== captureId)
    throw new Error("Media belongs to another recording");
  if (record.backend === "neon") {
    // Retain the tombstone even after deletion: a concurrently running recovery
    // must never recreate an intentionally deleted object or its metadata.
    const rows = await query<{body: MediaRecord}>(`UPDATE records SET body=jsonb_set(body,'{deletedAt}',to_jsonb($3::text),true),updated_at=now() WHERE workspace_id=$1 AND kind='media' AND id=$2 RETURNING body`, [workspace, mid, record.deletedAt || new Date().toISOString()]);
    if (!rows[0]) return;
    record = rows[0].body;
    await neonDelete(record.location);
    return;
  }
  if (record.backend === "blob") await blobDelete(record.location);
  else {
    requireLocalStorage();
    try {
      await unlink(record.location);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
  }
  await remove(workspace, "media", mid);
}

export async function cleanupStorageIntents() {
  const intents = await query<{
    workspace_id: string;
    body: { id: string; backend: "blob" | "local" | "neon"; location: string; uploadIntentId?: string; cleanupUploadIntent?: string };
  }>(
    `SELECT workspace_id,body FROM records WHERE kind='media_storage_intent' AND (body->>'cleanupAfter')::timestamptz<=now() LIMIT 100`,
  );
  let failed = 0;
  for (const row of intents) {
    try {
      let registered = await get<MediaRecord>(row.workspace_id, "media", row.body.id);
      if (!registered && row.body.uploadIntentId) {
        const upload = await get<{ state: string; mediaId?: string; record?: MediaRecord }>(row.workspace_id, "neon_upload_intent", row.body.uploadIntentId);
        if (upload?.state === "complete" && upload.mediaId === row.body.id && upload.record?.location === row.body.location) {
          registered = await registerMediaIfAbsent(row.workspace_id, upload.record) || await get<MediaRecord>(row.workspace_id, "media", row.body.id);
        }
      }
      if (!registered) {
        if (row.body.backend === "neon") await neonDelete(row.body.location);
        else if (row.body.backend === "blob") await blobDelete(row.body.location);
        else {
          requireLocalStorage();
          try {
            await unlink(row.body.location);
          } catch (e) {
            if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
          }
        }
      }
      if (row.body.cleanupUploadIntent) {
        const upload = await get<{state:string; mediaId?:string; record?:MediaRecord}>(row.workspace_id, "neon_upload_intent", row.body.cleanupUploadIntent);
        if (upload?.state === "complete" && upload.mediaId && upload.record && !await get<MediaRecord>(row.workspace_id, "media", upload.mediaId)) {
          const pending = await get<{location:string}>(row.workspace_id, "media_storage_intent", upload.mediaId);
          if (pending?.location === upload.record.location) await registerMediaIfAbsent(row.workspace_id, upload.record);
        }
        await remove(row.workspace_id, "neon_upload_intent", row.body.cleanupUploadIntent);
      }
      await remove(row.workspace_id, "media_storage_intent", row.body.id);
    } catch {
      failed++;
    }
  }
  return { checked: intents.length, failed };
}
