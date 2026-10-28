import { requireIdentity, apiError } from "@/lib/auth";
import { query } from "@/lib/db";
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireIdentity();
    const { id } = await params;
    const events = await query(
      `SELECT id,game_id AS "gameId",session_id AS "sessionId",player_id AS "playerId",kind,name,occurred_at AS timestamp,country,device,source,campaign,page,properties FROM events WHERE workspace_id=$1 AND session_id=$2 ORDER BY occurred_at LIMIT 5000`,
      [user.workspace_id, id],
    );
    if (!events.length)
      return Response.json({ error: "Session not found" }, { status: 404 });
    return Response.json(
      { session: events[0], events },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return apiError(e);
  }
}
