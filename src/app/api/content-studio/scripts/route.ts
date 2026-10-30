import { z } from "zod";
import { requireIdentity, apiError, HttpError } from "@/lib/auth";
import { sameOrigin } from "@/lib/security";
import { rateLimit } from "@/lib/db";
import { approveScriptReview, reviewScriptProposal, saveContentScript, scriptState, startScriptReview } from "@/lib/content-scripts";
const id = z.string().min(1).max(100);
const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("draft"), ideaId: id }).strict(),
  z.object({ action: z.literal("save"), ideaId: id, text: z.string().min(20).max(5000), expectedRevision: z.string().optional() }).strict(),
  z.object({ action: z.literal("review_proposal"), scriptId: id }).strict(),
  z.object({ action: z.literal("approve_review"), scriptId: id, reviewHash: z.string().regex(/^[a-f0-9]{64}$/), requestId: z.string().uuid(), maxCostCents: z.literal(1), acknowledgeCost: z.literal(true) }).strict(),
  z.object({ action: z.literal("start_review"), reviewId: id }).strict(),
]);
export async function GET(request: Request) {
  try { const user = await requireIdentity(); const ideaId = id.parse(new URL(request.url).searchParams.get("ideaId")); return Response.json(await scriptState(user.workspace_id, ideaId), { headers: { "Cache-Control": "private, no-store" } }); }
  catch (error) { return apiError(error); }
}
export async function POST(request: Request) {
  try {
    if (!sameOrigin(request)) throw new HttpError(403, "Use this workspace to edit or review scripts.");
    const user = await requireIdentity(); if (!await rateLimit(`content-scripts:${user.workspace_id}`, 30)) throw new HttpError(429, "Too many requests.");
    const reader = request.body?.getReader(); if (!reader) throw new HttpError(400, "Missing request.");
    const chunks: Uint8Array[] = []; let size = 0;
    for (;;) { const p = await reader.read(); if (p.done) break; size += p.value.byteLength; if (size > 32768) { await reader.cancel(); throw new HttpError(413, "Request too large."); } chunks.push(p.value); }
    const body = schema.parse(JSON.parse(Buffer.concat(chunks, size).toString("utf8"))); const ws = user.workspace_id;
    let result: unknown;
    if (body.action === "draft") result = await saveContentScript(ws, body.ideaId);
    if (body.action === "save") result = await saveContentScript(ws, body.ideaId, body.text, body.expectedRevision);
    if (body.action === "review_proposal") { const p = await reviewScriptProposal(ws, body.scriptId); result = { reviewHash: p.reviewHash, scriptRevision: p.script.revision, ...p.binding, inputBytes: p.inputBytes, questionCount: p.questionCount, pricing: p.pricing, costAdmission: p.costAdmission, enabled: process.env.BLAZE_JEV_SCRIPT_REVIEW_ENABLED === "true" }; }
    if (body.action === "approve_review") result = await approveScriptReview(ws, user.id, body);
    if (body.action === "start_review") result = await startScriptReview(ws, body.reviewId);
    return Response.json({ result }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { if (error instanceof z.ZodError || error instanceof SyntaxError) return Response.json({ error: "Check the script and review acknowledgement." }, { status: 400 }); return apiError(error); }
}
