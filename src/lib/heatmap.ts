import { query } from "./db";
import { pointerCte, sessionsCte, windowParams, querySessionPage } from "./analytics-sql";

export type HeatmapContext = { surface: "game" | "viewport"; screen: string; device: "mobile" | "tablet" | "desktop" | "Unknown" };
export type HeatmapScope = { gameId: string; days: number; end: number; sessionId?: string; context?: HeatmapContext };
export type HeatmapResponse = {
 windowStart: string; windowEnd: string;
 contexts: (HeatmapContext & {sampleCount: number; sessionCount: number})[];
 selectedContext: HeatmapContext | null;
 bins: {bx: number; by: number; x: number; y: number; count: number}[];
 sampleCount: number; coordinateSessions: number; eligibleSessions: number;
 recentSessions: {id: string; startedAt: string; device: string; country: string}[]; recentSessionsTotal: number;
};

/** Human pointer samples only; each map represents a single coordinate space. */
export async function queryHeatmap(workspace: string, scope: HeatmapScope): Promise<HeatmapResponse> {
 const params = windowParams(workspace, scope.gameId, scope.days, scope.end);
 const [result, page] = await Promise.all([query<{data: Omit<HeatmapResponse, "windowStart" | "windowEnd" | "recentSessions" | "recentSessionsTotal">}>(`${sessionsCte}, ${pointerCte},
 valid AS MATERIALIZED (SELECT * FROM pointer_data WHERE x BETWEEN 0 AND 1 AND y BETWEEN 0 AND 1 AND surface IS NOT NULL AND ($5::text IS NULL OR session_id=$5)),
 contexts AS (SELECT surface,screen,device,count(*)::int sample_count,count(DISTINCT session_id)::int session_count FROM valid GROUP BY 1,2,3),
 selected AS (SELECT surface,screen,device FROM contexts WHERE $6::text IS NULL ORDER BY sample_count DESC,surface,screen,device LIMIT 1),
 chosen AS (SELECT $6::text surface,$7::text screen,$8::text device WHERE $6::text IS NOT NULL UNION ALL SELECT * FROM selected),
 samples AS (SELECT v.* FROM valid v JOIN chosen c USING(surface,screen,device)),
 bins AS (SELECT least(19,floor(x*20))::int bx,least(19,floor(y*20))::int by,count(*)::int count FROM samples GROUP BY 1,2)
 SELECT jsonb_build_object(
 'contexts',coalesce((SELECT jsonb_agg(jsonb_build_object('surface',surface,'screen',screen,'device',device,'sampleCount',sample_count,'sessionCount',session_count) ORDER BY sample_count DESC,surface,screen,device) FROM contexts),'[]'::jsonb),
 'selectedContext',(SELECT jsonb_build_object('surface',surface,'screen',screen,'device',device) FROM chosen),
 'bins',coalesce((SELECT jsonb_agg(jsonb_build_object('bx',bx,'by',by,'x',bx/20.0+0.025,'y',by/20.0+0.025,'count',count) ORDER BY bx,by) FROM bins),'[]'::jsonb),
 'sampleCount',(SELECT count(*) FROM samples), 'coordinateSessions',(SELECT count(DISTINCT session_id) FROM samples),
 'eligibleSessions',(SELECT count(*) FROM sessions WHERE $5::text IS NULL OR session_id=$5)
 ) data`, [...params, scope.sessionId ?? null, scope.context?.surface ?? null, scope.context?.screen ?? null, scope.context?.device ?? null]), querySessionPage(workspace,scope.gameId,scope.days,{now:scope.end,limit:100})]);
 return {...result[0].data, windowStart:params[2]!,windowEnd:params[3]!, recentSessions:page.sessions.map(({id,startedAt,device,country})=>({id,startedAt,device,country})),recentSessionsTotal:page.total};
}
