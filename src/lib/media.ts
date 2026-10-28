import { mkdir, writeFile, readFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import {
  put as blobPut,
  get as blobGet,
  del as blobDelete,
} from "@vercel/blob";
import { id, put, get, query, remove } from "./db";
export interface MediaRecord {
  id: string;
  recordingId: string;
  clipId?: string;
  kind: string;
  contentType: string;
  size: number;
  location: string;
  backend: "blob" | "local";
  createdAt: string;
  captureId?: string;
  sessionId?: string;
  expiresAt?: string;
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
  if (!contentType) throw new Error("Unsupported media data");
  const backend: "blob" | "local" = process.env.BLOB_READ_WRITE_TOKEN
    ? "blob"
    : "local";
  if (backend === "local" && process.env.VERCEL)
    throw new Error("Private media storage is not configured");
  const storagePath =
    backend === "blob"
      ? `${workspace}/${mid}`
      : join(".data/media", workspace, mid);
  const intent = {
    id: mid,
    location: storagePath,
    backend,
    createdAt: new Date().toISOString(),
    cleanupAfter: new Date(Date.now() + 10 * 60000).toISOString(),
  };
  // The cleanup pointer is durable before footage is written, including uncertain uploads.
  await put(workspace, "media_storage_intent", intent);
  let location = storagePath;
  try {
    if (backend === "blob") {
      const blob = await blobPut(storagePath, bytes, {
        access: "private",
        contentType,
        addRandomSuffix: false,
        allowOverwrite: false,
      });
      location = blob.url;
    } else {
      await mkdir(join(".data/media", workspace), { recursive: true });
      await writeFile(location, bytes, { mode: 0o600, flag: "wx" });
    }
    await put<MediaRecord>(workspace, "media", {
      id: mid,
      recordingId,
      clipId,
      kind,
      contentType,
      size: bytes.length,
      location,
      backend,
      createdAt: new Date().toISOString(),
      ...capture,
    });
    await remove(workspace, "media_storage_intent", mid).catch(() => {});
  } catch (error) {
    try {
      if (backend === "blob") await blobDelete(storagePath);
      else
        try {
          await unlink(storagePath);
        } catch (e) {
          if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
        }
      await remove(workspace, "media_storage_intent", mid);
    } catch {
      /* Intent remains durable for cleanup retry. */
    }
    throw error;
  }
  return `/api/media/${mid}`;
}
export async function mediaRecord(workspace: string, mid: string) {
  return get<MediaRecord>(workspace, "media", mid);
}
export async function mediaBytes(record: MediaRecord) {
  if (record.expiresAt && Date.parse(record.expiresAt) <= Date.now())
    throw new Error("Media expired");
  if (record.backend === "local") return readFile(record.location);
  const blob = await blobGet(record.location, { access: "private" });
  if (!blob || blob.statusCode !== 200) throw new Error("Media unavailable");
  return Buffer.from(await new Response(blob.stream).arrayBuffer());
}
export async function lookupMedia(mid: string) {
  return (
    await query<{ workspace_id: string; body: MediaRecord }>(
      `SELECT workspace_id,body FROM records WHERE kind='media' AND id=$1`,
      [mid],
    )
  )[0];
}
export async function serveMedia(record: MediaRecord, request: Request) {
  if (record.expiresAt && Date.parse(record.expiresAt) <= Date.now())
    return new Response(null, { status: 410 });
  if (record.captureId) {
    const grant = (
      await query<{ state: string }>(
        `SELECT state FROM session_capture_grants WHERE capture_id=$1`,
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
  const record = await mediaRecord(workspace, mid);
  if (!record) return;
  if (captureId && record.captureId !== captureId)
    throw new Error("Media belongs to another recording");
  if (record.backend === "blob") await blobDelete(record.location);
  else
    try {
      await unlink(record.location);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
  await remove(workspace, "media", mid);
}

export async function cleanupStorageIntents() {
  const intents = await query<{
    workspace_id: string;
    body: { id: string; backend: "blob" | "local"; location: string };
  }>(
    `SELECT workspace_id,body FROM records WHERE kind='media_storage_intent' AND (body->>'cleanupAfter')::timestamptz<=now() LIMIT 100`,
  );
  let failed = 0;
  for (const row of intents) {
    try {
      const registered = await mediaRecord(row.workspace_id, row.body.id);
      if (!registered) {
        if (row.body.backend === "blob") await blobDelete(row.body.location);
        else
          try {
            await unlink(row.body.location);
          } catch (e) {
            if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
          }
      }
      await remove(row.workspace_id, "media_storage_intent", row.body.id);
    } catch {
      failed++;
    }
  }
  return { checked: intents.length, failed };
}
