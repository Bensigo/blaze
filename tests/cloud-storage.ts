// Explicit opt-in live infrastructure acceptance. Creates and removes only its own synthetic Blob.
import { createServer } from "node:http";
import { randomUUID, randomBytes } from "node:crypto";
import { upload } from "@vercel/blob/client";
import { del } from "@vercel/blob";
process.loadEnvFile(".env.vercel.local");
delete process.env.DATABASE_URL;
delete process.env.VERCEL;
process.env.LOCAL_DATABASE_PATH = "memory://";
process.env.WORKER_TOKEN = randomBytes(32).toString("hex");
const db = await import("../src/lib/db");
const media = await import("../src/lib/media");
const tokenRoute = await import("../src/app/api/worker/blob-upload/route");
const assetRoute = await import("../src/app/api/worker/asset/route");
const recordingId = `rec_${randomUUID().replaceAll("-", "")}`;
await db.query(
  `INSERT INTO jobs(id,workspace_id,kind,state,body,lease_until) VALUES($1,'storage-acceptance','recording','claimed','{}',now()+interval '2 minutes')`,
  [recordingId],
);
const server = createServer(async (req, res) => {
  try {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const request = new Request(`http://127.0.0.1:4186${req.url}`, {
      method: req.method,
      headers: req.headers as Record<string, string>,
      body: Buffer.concat(chunks),
    });
    const response = await tokenRoute.POST(request);
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch {
    res.writeHead(500);
    res.end();
  }
});
await new Promise<void>((resolve) => server.listen(4186, "127.0.0.1", resolve));
let uploaded: string | undefined;
try {
  const bytes = new Uint8Array(6 * 1024 * 1024).fill(18);
  bytes.set([0x1a, 0x45, 0xdf, 0xa3]);
  const pathname = `worker/${recordingId}/${randomUUID()}.webm`;
  const result = await upload(pathname, new Blob([bytes]), {
    access: "private",
    handleUploadUrl: "http://127.0.0.1:4186/api/worker/blob-upload",
    headers: { Authorization: `Bearer ${process.env.WORKER_TOKEN}` },
    clientPayload: JSON.stringify({ recordingId, kind: "video" }),
    contentType: "video/webm",
    multipart: true,
  });
  uploaded = result.url;
  const finalized = await assetRoute.POST(
    new Request("http://127.0.0.1:4186/api/worker/asset", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.WORKER_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        recordingId,
        kind: "video",
        blobUrl: result.url,
        pathname: result.pathname,
        size: bytes.length,
      }),
    }),
  );
  if (!finalized.ok) throw new Error(`Finalize failed (${finalized.status})`);
  const { url } = await finalized.json();
  const record = await media.mediaRecord(
    "storage-acceptance",
    url.split("/").pop(),
  );
  if (!record) throw new Error("Asset record missing");
  const response = await media.serveMedia(
    record,
    new Request("http://localhost/media", {
      headers: { Range: "bytes=1024-2047" },
    }),
  );
  if (
    response.status !== 206 ||
    response.headers.get("content-range") !==
      `bytes 1024-2047/${bytes.length}` ||
    (await response.arrayBuffer()).byteLength !== 1024
  )
    throw new Error("Private Blob range transfer failed");
  console.log(
    JSON.stringify({
      directUploadBytes: bytes.length,
      privateBlob: "verified",
      finalize: "verified",
      authenticatedRangeBytes: 1024,
      providerWrites: "none",
    }),
  );
} finally {
  if (uploaded) await del(uploaded);
  await new Promise<void>((resolve, reject) =>
    server.close((e) => (e ? reject(e) : resolve())),
  );
}
