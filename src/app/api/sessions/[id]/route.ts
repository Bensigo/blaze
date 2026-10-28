import { requireIdentity, apiError } from "@/lib/auth";
import { query } from "@/lib/db";
import type { SessionCapture } from "@/lib/types";
import { replayCoverage } from "@/lib/replay-coverage";
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireIdentity();
    const { id } = await params;
    let gameId = new URL(request.url).searchParams.get("gameId");
    if (!gameId) {
      const matches = await query<{game_id: string}>(`SELECT DISTINCT game_id FROM events WHERE workspace_id=$1 AND session_id=$2 ORDER BY game_id LIMIT 2`, [user.workspace_id, id]);
      if (matches.length > 1) return Response.json({error:"Specify the game for this session."},{status:400});
      gameId = matches[0]?.game_id || null;
    }
    const events = await query(
      `SELECT id,game_id AS "gameId",session_id AS "sessionId",player_id AS "playerId",kind,name,occurred_at AS timestamp,country,device,source,campaign,page,properties FROM events WHERE workspace_id=$1 AND session_id=$2 ${gameId ? "AND game_id=$3" : ""} ORDER BY occurred_at,id LIMIT 5001`,
      gameId ? [user.workspace_id, id, gameId] : [user.workspace_id, id],
    );
    if (!events.length)
      return Response.json({ error: "Session not found" }, { status: 404 });
    const event = events[0] as { gameId: string };
    const captures = (await query<{body: SessionCapture}>(
      `SELECT body FROM records WHERE workspace_id=$1 AND kind='session_capture' AND body->>'sessionId'=$2 AND body->>'gameId'=$3 ORDER BY (body->>'segment')::int NULLS FIRST,updated_at LIMIT 4`,
      [user.workspace_id,id,gameId || event.gameId],
    )).map(({body: capture}) => Date.parse(capture.expiresAt) <= Date.now() ? { ...capture, status: "expired" as const, videoUrl: undefined } : capture.status !== "ready" ? { ...capture, videoUrl: undefined } : capture);
    const capture = captures.find((c) => c.status === "ready") || captures[0];
    const bounds = (await query<{startedAt: Date; lastAt: Date}>(`SELECT min(occurred_at) AS "startedAt",max(occurred_at) AS "lastAt" FROM events WHERE workspace_id=$1 AND session_id=$2 AND game_id=$3`, [user.workspace_id,id,gameId || event.gameId]))[0];
    const coverage = replayCoverage(captures, new Date(bounds.startedAt).toISOString(), new Date(bounds.lastAt).toISOString());
    return Response.json(
      { session: events[0], events: events.slice(0,5000), eventsTruncated: events.length > 5000, capture, captures, coverage },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return apiError(e);
  }
}
