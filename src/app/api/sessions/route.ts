import { requireIdentity, apiError } from "@/lib/auth";
import { querySessionPage } from "@/lib/analytics";

export async function GET(request: Request) {
  try {
    const user = await requireIdentity();
    const search = new URL(request.url).searchParams;
    const days = Number(search.get("days") || 14);
    const limit = Number(search.get("limit") || 100);
    const gameId = search.get("gameId") || undefined;
    const cursor = search.get("cursor") || undefined;
    if (![7,14,30].includes(days) || !Number.isInteger(limit) || limit < 1 || limit > 100 || (gameId && gameId.length > 256))
      return Response.json({error:"Invalid session query"},{status:400});
    try {
      const page = await querySessionPage(user.workspace_id,gameId,days,{limit,cursor});
      return Response.json(page,{headers:{"Cache-Control":"no-store"}});
    } catch (error) {
      if (error instanceof Error && error.message === "Invalid session cursor") return Response.json({error:error.message},{status:400});
      throw error;
    }
  } catch(error) { return apiError(error); }
}
