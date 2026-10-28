import { requireIdentity, apiError, HttpError } from "@/lib/auth";
import { get } from "@/lib/db";
import { queryHeatmap, type HeatmapContext } from "@/lib/heatmap";

export async function GET(request: Request) {
 try {
  const user=await requireIdentity(), p=new URL(request.url).searchParams;
  const gameId=p.get("gameId") || "", daysValue=p.get("days") ?? "14", days=Number(daysValue), endValue=p.get("end"), end=endValue ? Date.parse(endValue) : Date.now();
  const sessionId=p.get("sessionId"), surface=p.get("surface"), screen=p.get("screen"), device=p.get("device");
  const hasContext=surface!==null || screen!==null || device!==null;
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(gameId) || !/^(?:[1-9]|[1-8][0-9]|90)$/.test(daysValue) || !Number.isFinite(end) || end>Date.now()+60000 || end<Date.now()-90*86400000 || (sessionId!==null && (!sessionId || sessionId.length>100 || /[\x00-\x1f\x7f]/.test(sessionId))) || (hasContext && ((surface!=="game" && surface!=="viewport") || !screen || !/^[A-Za-z0-9_-]{1,40}$/.test(screen) || !device || !["mobile","tablet","desktop","Unknown"].includes(device)))) throw new HttpError(400,"Invalid heatmap query.");
  if (!await get(user.workspace_id,"game",gameId)) throw new HttpError(404,"Game not found.");
  const context=hasContext ? {surface,screen,device} as HeatmapContext : undefined;
  return Response.json(await queryHeatmap(user.workspace_id,{gameId,days,end,sessionId:sessionId ?? undefined,context}),{headers:{"Cache-Control":"private, no-store"}});
 } catch(error) { return apiError(error); }
}
