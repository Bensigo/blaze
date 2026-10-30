import { z } from "zod";
import { requireIdentity, apiError, HttpError } from "@/lib/auth";
import { sameOrigin } from "@/lib/security";
import { rateLimit } from "@/lib/db";
import { approvePilotVideo, reviewPilotVideo, startApprovedVideo, videoSettingsSchema } from "@/lib/content-studio";
const inputs = { ideaId: z.string().min(1).max(100), settings: videoSettingsSchema, maxListCostCents: z.number().int().min(1).max(5000) };
const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("review"), ...inputs }).strict(),
  z.object({ action: z.literal("approve"), ...inputs, requestId: z.string().uuid(), reviewHash: z.string().regex(/^[a-f0-9]{64}$/), acknowledgeCost: z.literal(true), confirm: z.literal("Approve one cloud gameplay pilot") }).strict(),
  z.object({ action: z.literal("start"), productionId: z.string().min(1).max(100) }).strict(),
]);
export async function POST(request: Request) {
  try {
    if (!sameOrigin(request)) throw new HttpError(403, "Use this workspace to approve a pilot.");
    const user = await requireIdentity();
    if (!await rateLimit(`content-pilot:${user.workspace_id}`, 20)) throw new HttpError(429, "Too many pilot requests.");
    const reader = request.body?.getReader(); if (!reader) throw new HttpError(400, "Missing request.");
    const chunks: Uint8Array[] = []; let size = 0;
    for (;;) { const p = await reader.read(); if (p.done) break; size += p.value.byteLength; if (size > 16384) { await reader.cancel(); throw new HttpError(413, "Request too large."); } chunks.push(p.value); }
    const body = schema.parse(JSON.parse(Buffer.concat(chunks, size).toString("utf8")));
    const result = body.action === "review" ? await reviewPilotVideo(user.workspace_id, user.id, body) : body.action === "approve" ? await approvePilotVideo(user.workspace_id, user.id, body) : await startApprovedVideo(user.workspace_id, body.productionId, user.id);
    return Response.json({ result }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { if (error instanceof z.ZodError || error instanceof SyntaxError) return Response.json({ error: "Check the exact pilot settings and acknowledgement." }, { status: 400 }); return apiError(error); }
}
