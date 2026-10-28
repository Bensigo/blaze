import { mkdir, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { put as blobPut, get as blobGet } from "@vercel/blob";
import { id, put, get, query } from "./db";
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
}
export async function saveAsset(
  workspace: string,
  recordingId: string,
  kind: string,
  file: File,
  clipId?: string,
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
    kind === "video" &&
    bytes.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))
  )
    contentType = "video/webm";
  if (kind === "clip" && bytes.subarray(4, 8).toString() === "ftyp")
    contentType = "video/mp4";
  if (!contentType) throw new Error("Unsupported media data");
  let location = "",
    backend: "blob" | "local" = "local";
  if (process.env.BLOB_READ_WRITE_TOKEN) {
    const blob = await blobPut(`${workspace}/${mid}`, bytes, {
      access: "private",
      contentType,
      addRandomSuffix: true,
    });
    location = blob.url;
    backend = "blob";
  } else {
    if (process.env.VERCEL)
      throw new Error("Private media storage is not configured");
    await mkdir(".data/media", { recursive: true });
    location = join(".data/media", mid);
    await writeFile(location, bytes, { mode: 0o600 });
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
  });
  return `/api/media/${mid}`;
}
export async function mediaRecord(workspace: string, mid: string) {
  return get<MediaRecord>(workspace, "media", mid);
}
export async function mediaBytes(record: MediaRecord) {
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
