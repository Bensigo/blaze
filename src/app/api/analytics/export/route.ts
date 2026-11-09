import { apiError, HttpError, requireIdentity } from "@/lib/auth";
import { analytics } from "@/lib/analytics";
import { analyticsCsv } from "@/lib/analytics-export";
import { get, rateLimit } from "@/lib/db";
import type { Game } from "@/lib/types";

export async function GET(request: Request) {
  try {
    const user = await requireIdentity();
    if(!await rateLimit(`analytics-export:${user.workspace_id}`,10)) throw new HttpError(429,"Too many exports. Try again shortly.");
    const params = new URL(request.url).searchParams;
    if([...params.keys()].some(key=>!["days","gameId"].includes(key)||params.getAll(key).length!==1)) throw new HttpError(400,"Invalid export parameter.");
    const days = Number(params.get("days") || 14);
    if(![7,14,30].includes(days)) throw new HttpError(400,"Choose a 7, 14 or 30 day export.");
    const gameId = params.get("gameId") || undefined;
    if(gameId && (!/^[A-Za-z0-9_-]{1,100}$/.test(gameId) || !await get<Game>(user.workspace_id,"game",gameId))) throw new HttpError(404,"Game not found.");
    const data = await analytics(user.workspace_id,gameId,days);
    return new Response(analyticsCsv(data,{days,gameId,generatedAt:new Date().toISOString()}),{headers:{"Content-Type":"text/csv; charset=utf-8","Content-Disposition":`attachment; filename="blaze-analytics-${days}d.csv"`,"Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff"}});
  } catch(error) { return apiError(error); }
}
