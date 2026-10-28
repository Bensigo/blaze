import { requireIdentity, apiError } from "@/lib/auth";
import { query, list } from "@/lib/db";
import type { SessionCapture } from "@/lib/types";
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireIdentity();
    const { id } = await params;
    const gameId = new URL(request.url).searchParams.get("gameId");
    const events = await query(
      `SELECT id,game_id AS "gameId",session_id AS "sessionId",player_id AS "playerId",kind,name,occurred_at AS timestamp,country,device,source,campaign,page,properties FROM events WHERE workspace_id=$1 AND session_id=$2 ${gameId ? "AND game_id=$3" : ""} ORDER BY occurred_at LIMIT 5000`,
      gameId ? [user.workspace_id, id, gameId] : [user.workspace_id, id],
    );
    if (!events.length)
      return Response.json({ error: "Session not found" }, { status: 404 });
    const event = events[0] as { gameId: string };
    let capture = (
      await list<SessionCapture>(user.workspace_id, "session_capture")
    ).find((c) => c.sessionId === id && c.gameId === (gameId || event.gameId));
    if (capture) {
      if (Date.parse(capture.expiresAt) <= Date.now())
        capture = { ...capture, status: "expired", videoUrl: undefined };
      else if (capture.status !== "ready")
        capture = { ...capture, videoUrl: undefined };
    }
    return Response.json(
      { session: events[0], events, capture },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return apiError(e);
  }
}
