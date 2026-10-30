import { z } from "zod";
import { bearer } from "@/lib/security";
import { tickProductionWatchdog } from "@/lib/content-production-watchdog";
export const maxDuration = 60;
export async function POST(request: Request) {
  if (!bearer(request, "CRON_SECRET")) return new Response(null, { status: 401 });
  if (process.env.BLAZE_CLOUD_WATCHDOG_ENABLED !== "true") return Response.json({ paused: true });
  const reader = request.body?.getReader();
  if (!reader) return Response.json({ error: "Workspace is required." }, { status: 400 });
  const chunks: Uint8Array[] = []; let size = 0;
  for (;;) { const part = await reader.read(); if (part.done) break; size += part.value.byteLength; if (size > 1024) { await reader.cancel(); return new Response(null, { status: 413 }); } chunks.push(part.value); }
  let workspaceId: string;
  try { ({ workspaceId } = z.object({ workspaceId: z.string().min(1).max(100) }).strict().parse(JSON.parse(Buffer.concat(chunks, size).toString("utf8")))); }
  catch { return Response.json({ error: "Workspace is required." }, { status: 400 }); }
  try { return Response.json(await tickProductionWatchdog(workspaceId), { headers: { "Cache-Control": "private, no-store" } }); }
  catch { return Response.json({ error: "Watchdog did not complete. New production requires a fresh healthy heartbeat." }, { status: 503 }); }
}
