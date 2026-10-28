import { rateLimit } from "@/lib/db";
import { verifySyntheticCapability } from "@/lib/synthetic-capability";

const headers = { "Cache-Control": "no-store" };
export async function POST(request: Request) {
  // A global ceiling protects the public endpoint even if caller addresses are spoofed.
  if (!await rateLimit("synthetic-verify-global", 600, 60)) return Response.json({ synthetic: false }, { status: 429, headers });
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) return Response.json({ synthetic: false }, { status: 400, headers });
  try {
    if (Number(request.headers.get("content-length") || 0) > 2048 || !request.body) throw new Error("Invalid body");
    const reader = request.body.getReader();
    const chunks: Uint8Array[] = []; let size = 0;
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.length; if (size > 2048) { await reader.cancel(); throw new Error("Body too large"); }
      chunks.push(value);
    }
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).sort().join(",") !== "capability,gameId,guestSessionId,origin" ||
        Object.values(body).some(value => typeof value !== "string")) throw new Error("Invalid body");
    const synthetic = await verifySyntheticCapability(body);
    return Response.json({ synthetic }, { status: synthetic ? 200 : 403, headers });
  } catch { return Response.json({ synthetic: false }, { status: 400, headers }); }
}
