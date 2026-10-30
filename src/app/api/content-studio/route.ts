import { rejectContentIdea } from "@/lib/content-preferences";
import { z } from "zod";
import { requireIdentity, apiError, HttpError } from "@/lib/auth";
import { sameOrigin } from "@/lib/security";
import { rateLimit } from "@/lib/db";
import { approveVideo, cancelVideo, planVideo, prepareSourceIdeas, refreshVideo, saveIdeaSchedule, scheduleSchema, startApprovedVideo, studioSnapshot, videoSettingsSchema } from "@/lib/content-studio";
const recordId = z.string().min(1).max(100);
const actionSchema = z.discriminatedUnion("action", [
  z.object({action:z.literal("reject"),ideaId:recordId,reason:z.string().trim().max(300).optional()}).strict(),
  z.object({ action: z.literal("prepare_outlines"), gameId: recordId }).strict(),
  z.object({ action: z.literal("save_schedule"), schedule: scheduleSchema }).strict(),
  z.object({ action: z.literal("approve"), ideaId: recordId, requestId: z.string().uuid(), settings: videoSettingsSchema, maxListCostCents: z.number().int().min(1).max(5000), acknowledgeCost: z.literal(true) }).strict(),
  z.object({ action: z.literal("generate"), providerRevision: recordId, scriptRevision: z.string().min(1).max(128), scriptReviewId: recordId, ideaId: recordId, requestId: z.string().uuid(), settings: videoSettingsSchema, maxListCostCents: z.number().int().min(1).max(5000), acknowledgeCost: z.literal(true) }).strict(),
  z.object({ action: z.literal("start"), productionId: recordId }).strict(),
  z.object({ action: z.literal("refresh"), productionId: recordId }).strict(),
  z.object({ action: z.literal("cancel"), productionId: recordId }).strict(),
  z.object({ action: z.literal("plan"), productionId: recordId, date: z.string().nullable() }).strict(),
]);
export async function GET(request: Request) {
  try {
    const user = await requireIdentity();
    const gameId = new URL(request.url).searchParams.get("gameId") || undefined;
    if (gameId) recordId.parse(gameId);
    return Response.json(await studioSnapshot(user.workspace_id, gameId, user.id), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return apiError(error); }
}
export async function POST(request: Request) {
  try {
    if (!sameOrigin(request)) throw new HttpError(403, "Use this workspace to make changes.");
    const user = await requireIdentity();
    if (!await rateLimit(`content-studio:${user.workspace_id}`, 30)) throw new HttpError(429, "Too many requests. Try again shortly.");
    if (Number(request.headers.get("content-length") || 0) > 16384) throw new HttpError(413, "Request too large.");
    const reader = request.body?.getReader(); if (!reader) throw new HttpError(400, "Missing request.");
    const chunks: Uint8Array[] = []; let size = 0;
    for (;;) { const part = await reader.read(); if (part.done) break; size += part.value.byteLength; if (size > 16384) { await reader.cancel(); throw new HttpError(413, "Request too large."); } chunks.push(part.value); }
    const body = actionSchema.parse(JSON.parse(Buffer.concat(chunks, size).toString("utf8")));
    const workspace = user.workspace_id;
    let result: unknown;
    if (body.action === "reject") result=await rejectContentIdea(workspace,user.id,body.ideaId,body.reason);
    if (body.action === "prepare_outlines") result = await prepareSourceIdeas(workspace, body.gameId);
    if (body.action === "save_schedule") result = await saveIdeaSchedule(workspace, body.schedule);
    if (body.action === "approve") result = await approveVideo(workspace, user.id, body);
    if (body.action === "generate") {
      const grant = await approveVideo(workspace, user.id, body);
      result = grant.state === "approved" ? await startApprovedVideo(workspace, grant.id, user.id) : grant;
    }
    if (body.action === "start") result = await startApprovedVideo(workspace, body.productionId, user.id);
    if (body.action === "refresh") result = await refreshVideo(workspace, body.productionId);
    if (body.action === "cancel") result = await cancelVideo(workspace, body.productionId);
    if (body.action === "plan") result = await planVideo(workspace, body.productionId, body.date);
    return Response.json({ result }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof z.ZodError || error instanceof SyntaxError) return Response.json({ error: "Check the video settings and try again." }, { status: 400 });
    return apiError(error);
  }
}
