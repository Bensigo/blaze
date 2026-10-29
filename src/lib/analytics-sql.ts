import { query } from "./db";
import type { Analytics, SessionSummary, SessionCapture } from "./types";

// A stable event order also makes tied timestamps deterministic.
export const sessionsCte = `
WITH window_events AS MATERIALIZED (
 SELECT * FROM events WHERE workspace_id=$1 AND ($2::text IS NULL OR game_id=$2)
   AND occurred_at >= $3::timestamptz AND occurred_at <= $4::timestamptz AND received_at <= $4::timestamptz
), human AS (SELECT * FROM window_events WHERE kind='human'), numbered AS (
 SELECT *,row_number() OVER (PARTITION BY game_id,session_id ORDER BY occurred_at,id) seq FROM human
), activity AS (
 SELECT *,max(seq) FILTER (WHERE name='round_start') OVER (PARTITION BY game_id,session_id ORDER BY seq ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING) last_start,
 max(seq) FILTER (WHERE name IN ('round_complete','exit')) OVER (PARTITION BY game_id,session_id ORDER BY seq ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING) last_stop FROM numbered
), grouped AS (
 SELECT game_id, session_id,
   (array_agg(player_id ORDER BY occurred_at,id))[1] player_id,
   (array_agg(country ORDER BY occurred_at,id))[1] country,
   (array_agg(device ORDER BY occurred_at,id))[1] device,
   (array_agg(source ORDER BY occurred_at,id))[1] source,
   (array_agg(campaign ORDER BY occurred_at,id))[1] campaign,
   min(occurred_at) started_at, max(occurred_at) last_at, count(*)::int event_count,
   array_agg(name ORDER BY occurred_at,id) names,
   count(*) FILTER (WHERE name='retry')::int retries,
   count(*) FILTER (WHERE name='error')::int errors,
   bool_or(name='loaded') loaded, bool_or(name='progression') progressed,
   sum(CASE WHEN name='active_play' AND last_start IS NOT NULL AND last_start>coalesce(last_stop,0) AND jsonb_typeof(properties->'duration')='number'
     THEN greatest(0,least(15,(properties->>'duration')::numeric)) ELSE NULL END) active_seconds,
   coalesce(CASE WHEN jsonb_typeof(((array_agg(properties ORDER BY occurred_at DESC,id DESC) FILTER (WHERE name='progression'))[1])->'step')='string' THEN ((array_agg(properties ORDER BY occurred_at DESC,id DESC) FILTER (WHERE name='progression'))[1])->>'step' END,
     (array_agg(name ORDER BY occurred_at DESC,id DESC) FILTER (WHERE name NOT IN ('pointer','exit','active_play')))[1], 'Unknown') last_step
 FROM activity GROUP BY game_id,session_id
), positions AS (
 SELECT *, array_position(names,'visit') v FROM grouped
), pos2 AS (SELECT *, CASE WHEN v IS NOT NULL THEN array_position(names,'loaded',v+1) END l FROM positions),
pos3 AS (SELECT *, CASE WHEN v IS NOT NULL THEN array_position(names,'first_action',v+1) END a FROM pos2),
pos4 AS (SELECT *, CASE WHEN l IS NOT NULL THEN array_position(names,'round_start',l+1) END s FROM pos3),
sessions AS (
 SELECT p.*, CASE WHEN s IS NOT NULL AND a IS NOT NULL THEN array_position(names,'round_complete',greatest(s,a)+1) END c,
  'round_start'=ANY(names) started, 'round_complete'=ANY(names) completed,
  'first_action'=ANY(names) acted, 'exit'=ANY(names) exited,
  (f.first_at IS NOT NULL AND p.session_id<>f.first_session_id AND p.started_at >= f.first_at+interval '24 hours') returned
 FROM pos4 p LEFT JOIN player_first_seen f ON f.workspace_id=$1 AND f.game_id=p.game_id AND f.player_id=p.player_id
)`;
export const pointerCte = `pointer_data AS (SELECT game_id,session_id,id,occurred_at,
   CASE WHEN jsonb_typeof(properties->'x')='number' THEN (properties->>'x')::numeric END x,
   CASE WHEN jsonb_typeof(properties->'y')='number' THEN (properties->>'y')::numeric END y,
   CASE WHEN NOT (properties ? 'surface') AND NOT (properties ? 'screen') THEN 'viewport' WHEN jsonb_typeof(properties->'surface')='string' AND jsonb_typeof(properties->'screen')='string' AND properties->>'surface' IN ('game','viewport') AND properties->>'screen' ~ '^[A-Za-z0-9_-]{1,40}$' THEN properties->>'surface' END surface,
   CASE WHEN NOT (properties ? 'surface') AND NOT (properties ? 'screen') THEN 'unknown' WHEN jsonb_typeof(properties->'surface')='string' AND jsonb_typeof(properties->'screen')='string' AND properties->>'surface' IN ('game','viewport') AND properties->>'screen' ~ '^[A-Za-z0-9_-]{1,40}$' THEN properties->>'screen' END screen,
   CASE WHEN device IN ('mobile','tablet','desktop') THEN device ELSE 'Unknown' END device
   FROM human WHERE name='pointer')`;
const dropoffName = `CASE WHEN v IS NOT NULL AND NOT started THEN 'Viewed, no round start' WHEN started AND NOT acted THEN 'Started, no first action' ELSE coalesce(nullif(last_step,''),'Unknown') END`;

export function windowParams(workspace: string, gameId: string | undefined, days: number, now: number) {
  if (!Number.isInteger(days) || days < 1 || days > 90 || !Number.isFinite(now)) throw new Error("Invalid analytics window");
  return [workspace, gameId || null, new Date(now - days * 86400000).toISOString(), new Date(now).toISOString()];
}
function date(x: string | Date) { return new Date(x).toISOString(); }
type SessionRow = {cursor_started:string;game_id:string;session_id:string;player_id:string;country:string;device:string;source:string;campaign:string;started_at:string|Date;last_at:string|Date;event_count:number;completed:boolean;last_step:string;errors:number;active_seconds:string|number|null};
function session(r:SessionRow):SessionSummary {
 return {id:r.session_id,gameId:r.game_id,playerId:r.player_id,kind:"human",country:r.country,device:r.device,source:r.source,campaign:r.campaign,startedAt:date(r.started_at),lastAt:date(r.last_at),events:Number(r.event_count),completed:r.completed,lastStep:r.last_step,errors:Number(r.errors),duration:Math.max(0,(new Date(r.last_at).getTime()-new Date(r.started_at).getTime())/1000),activePlaySeconds:r.active_seconds === null ? null : Number(r.active_seconds)};
}
type Cursor = {v:1; workspace:string; game:string|null; days:number; end:string; started:string; gameId:string; id:string};
function decodeCursor(raw:string, workspace:string, gameId:string|undefined, days:number):Cursor {
 try {
   if (raw.length>4096) throw 0;
   const c=JSON.parse(Buffer.from(raw,"base64url").toString("utf8")) as Cursor;
   if(c.v!==1 || c.workspace!==workspace || c.game!==(gameId||null) || c.days!==days || !Number.isFinite(Date.parse(c.end)) || !Number.isFinite(Date.parse(c.started)) || typeof c.gameId!=="string" || typeof c.id!=="string") throw 0;
   return c;
 } catch { throw new Error("Invalid session cursor"); }
}
export async function addCaptureStatus(workspace:string, sessions:SessionSummary[]) {
 if (!sessions.length) return sessions;
 const pairs=JSON.stringify(sessions.map(s=>({game_id:s.gameId,session_id:s.id})));
 const captures=await query<{game_id:string;session_id:string;body:SessionCapture}>(`
 SELECT p.game_id,p.session_id,r.body FROM jsonb_to_recordset($2::jsonb) AS p(game_id text,session_id text)
 JOIN LATERAL (SELECT body FROM records WHERE workspace_id=$1 AND kind='session_capture' AND body->>'gameId'=p.game_id AND body->>'sessionId'=p.session_id ORDER BY updated_at DESC LIMIT 1) r ON true`,[workspace,pairs]);
 const map=new Map(captures.map(c=>[JSON.stringify([c.game_id,c.session_id]),c.body]));
 return sessions.map(s=>{ const c=map.get(JSON.stringify([s.gameId,s.id])); return {...s,captureId:c?.id,captureStatus:c && Date.parse(c.expiresAt)<=Date.now()?"expired" as const:c?.status}; });
}
export async function querySessionPage(workspace:string,gameId:string|undefined,days=14,options:{cursor?:string;limit?:number;now?:number}={}) {
 const limit=options.limit ?? 100;
 if(!Number.isInteger(limit)||limit<1||limit>100) throw new Error("Invalid session page limit");
 const cursor=options.cursor ? decodeCursor(options.cursor,workspace,gameId,days) : undefined;
 const now=cursor ? Date.parse(cursor.end) : options.now ?? Date.now();
 const params=windowParams(workspace,gameId,days,now);
 const rows=await query<SessionRow & {total:string|number}>(`${sessionsCte}
 SELECT game_id,session_id,player_id,country,device,source,campaign,started_at,last_at,event_count,completed,last_step,errors,active_seconds, to_char(started_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') cursor_started, (SELECT count(*) FROM sessions) total FROM sessions
 WHERE ($5::timestamptz IS NULL OR started_at<$5 OR (started_at=$5 AND (game_id,session_id)>($6::text,$7::text)))
 ORDER BY started_at DESC,game_id ASC,session_id ASC LIMIT $8`,[...params,cursor?.started??null,cursor?.gameId??null,cursor?.id??null,limit+1]);
 // Empty pages still need their true total.
 const total=rows.length?Number(rows[0].total):Number((await query<{total:string|number}>(`${sessionsCte} SELECT count(*) total FROM sessions`,params))[0].total);
 const shown=rows.slice(0,limit), last=shown.at(-1);
 const nextCursor=rows.length>limit && last ? Buffer.from(JSON.stringify({v:1,workspace,game:gameId||null,days,end:new Date(now).toISOString(),started:last.cursor_started,gameId:last.game_id,id:last.session_id} satisfies Cursor)).toString("base64url") : undefined;
 return {sessions:await addCaptureStatus(workspace,shown.map(session)),total,limit,nextCursor};
}

export async function sqlAnalytics(workspace:string,gameId?:string,days=14,now=Date.now()):Promise<Analytics> {
 const params=windowParams(workspace,gameId,days,now);
 const startDay=new Date(now-(days-1)*86400000).toISOString().slice(0,10);
 const [result,page]=await Promise.all([
 query<{data: Analytics & {coverage:Record<string,{shown:number;total:number}>}}>(`${sessionsCte},
 cohort AS (
 SELECT f.*, EXISTS(SELECT 1 FROM events e WHERE e.workspace_id=f.workspace_id AND e.game_id=f.game_id AND e.player_id=f.player_id AND e.kind='human' AND e.name='visit' AND e.session_id<>f.first_session_id AND e.occurred_at>=f.first_at+interval '24 hours' AND e.occurred_at<f.first_at+interval '48 hours' AND e.occurred_at<=$4::timestamptz AND e.received_at<=$4::timestamptz) came_back
 FROM player_first_seen f WHERE f.workspace_id=$1 AND ($2::text IS NULL OR f.game_id=$2) AND f.first_at >= ($5::date::timestamp AT TIME ZONE 'UTC') AND f.first_at < ((($4::timestamptz AT TIME ZONE 'UTC')::date + 1)::timestamp AT TIME ZONE 'UTC') AND f.first_at<=$4::timestamptz
), trend_days AS (SELECT ($5::date + n)::date AS day_date FROM generate_series(0,$6::int-1) n),
 country AS (SELECT coalesce(nullif(country,''),'Unknown') name,count(*)::int count FROM sessions GROUP BY 1),
 source AS (SELECT coalesce(nullif(source,''),'Unknown') name,count(*)::int count FROM sessions GROUP BY 1),
 device AS (SELECT coalesce(nullif(device,''),'Unknown') name,count(*)::int count FROM sessions GROUP BY 1),
 dropoff AS (SELECT ${dropoffName} name,count(*)::int count FROM sessions WHERE NOT completed GROUP BY 1),
 returned_players AS (SELECT DISTINCT game_id,player_id FROM sessions WHERE returned),
 campaign AS (SELECT s.campaign name,count(*)::int visits,count(*) FILTER(WHERE s.started)::int starts,count(*) FILTER(WHERE s.completed)::int completions,count(DISTINCT (s.game_id,s.player_id)) FILTER(WHERE r.player_id IS NOT NULL)::int returns FROM sessions s LEFT JOIN returned_players r USING(game_id,player_id) WHERE s.campaign<>'' GROUP BY s.campaign),
 conversion AS (SELECT coalesce(nullif(source,''),'Unknown') source,coalesce(nullif(campaign,''),'Unspecified') campaign,count(*)::int visits,count(*) FILTER(WHERE started)::int starts,count(*) FILTER(WHERE started AND (array_position(names,'round_complete',array_position(names,'round_start')+1) IS NOT NULL OR active_seconds>=30))::int meaningful,count(*) FILTER(WHERE started AND active_seconds IS NOT NULL)::int active_measured FROM sessions WHERE v IS NOT NULL GROUP BY 1,2),
 ${pointerCte},
 heat AS (SELECT game_id,surface,screen,device,least(19,floor(x*20))::int bx,least(19,floor(y*20))::int by,count(*)::int count FROM pointer_data WHERE x BETWEEN 0 AND 1 AND y BETWEEN 0 AND 1 AND surface IS NOT NULL GROUP BY 1,2,3,4,5,6)
 SELECT jsonb_build_object(
 'launch',jsonb_build_object('visits',(SELECT count(*) FROM sessions WHERE v IS NOT NULL),'exits',(SELECT count(*) FROM sessions WHERE exited),'coverage',jsonb_build_object('sessions',(SELECT count(*) FROM sessions),'visit',(SELECT count(*) FROM sessions WHERE v IS NOT NULL),'loaded',(SELECT count(*) FROM sessions WHERE loaded),'roundStart',(SELECT count(*) FROM sessions WHERE started),'firstAction',(SELECT count(*) FROM sessions WHERE acted),'roundComplete',(SELECT count(*) FROM sessions WHERE completed),'exit',(SELECT count(*) FROM sessions WHERE exited)),'conversion',coalesce((SELECT jsonb_agg(jsonb_build_object('source',source,'campaign',campaign,'visits',visits,'starts',starts,'meaningful',meaningful,'activeMeasured',active_measured) ORDER BY visits DESC,source,campaign) FROM (SELECT * FROM conversion ORDER BY visits DESC,source,campaign LIMIT 100) x),'[]'::jsonb),'conversionTotal',(SELECT count(*) FROM conversion)),
 'sessions',(SELECT count(*) FROM sessions),'players',(SELECT count(DISTINCT (game_id,player_id)) FROM sessions),
 'starts',(SELECT count(*) FROM sessions WHERE started),'completions',(SELECT count(*) FROM sessions WHERE completed),
 'replays',(SELECT coalesce(sum(retries),0) FROM sessions),'returns',(SELECT count(DISTINCT (game_id,player_id)) FROM sessions WHERE returned),
 'errorSessions',(SELECT count(*) FROM sessions WHERE errors>0),'firstActions',(SELECT count(*) FROM sessions WHERE acted),
 'loadedSessions',(SELECT count(*) FROM sessions WHERE loaded),'progressionSessions',(SELECT count(*) FROM sessions WHERE progressed),
 'activePlay',jsonb_build_object('totalSeconds',(SELECT sum(active_seconds) FROM sessions),'averageSeconds',(SELECT avg(active_seconds) FROM sessions),'medianSeconds',(SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY active_seconds) FROM sessions WHERE active_seconds IS NOT NULL),'measuredSessions',(SELECT count(*) FROM sessions WHERE active_seconds IS NOT NULL),'eligibleSessions',(SELECT count(*) FROM sessions WHERE started)),
 'lastEventAt',(SELECT max(occurred_at) FROM human),
 'syntheticSessions',(SELECT count(DISTINCT (game_id,session_id)) FROM window_events WHERE kind='agent'),
 'trend',(SELECT coalesce(jsonb_agg(jsonb_build_object('date',to_char(d.day_date,'YYYY-MM-DD'),'visits',coalesce(t.visits,0),'starts',coalesce(t.starts,0),'completions',coalesce(t.completions,0)) ORDER BY d.day_date),'[]'::jsonb) FROM trend_days d LEFT JOIN (SELECT (started_at AT TIME ZONE 'UTC')::date AS day_date,count(*) visits,count(*) FILTER(WHERE started) starts,count(*) FILTER(WHERE completed) completions FROM sessions GROUP BY 1) t ON d.day_date=t.day_date),
 'funnel',jsonb_build_array(jsonb_build_object('name','Visit','count',(SELECT count(*) FROM sessions WHERE v IS NOT NULL)),jsonb_build_object('name','Loaded','count',(SELECT count(*) FROM sessions WHERE l IS NOT NULL)),jsonb_build_object('name','Round started','count',(SELECT count(*) FROM sessions WHERE s IS NOT NULL)),jsonb_build_object('name','First action','count',(SELECT count(*) FROM sessions WHERE s IS NOT NULL AND a IS NOT NULL)),jsonb_build_object('name','Round completed','count',(SELECT count(*) FROM sessions WHERE c IS NOT NULL))),
 'countries',coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM (SELECT * FROM country ORDER BY count DESC,name LIMIT 50) x),'[]'::jsonb),
 'sources',coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM (SELECT * FROM source ORDER BY count DESC,name LIMIT 50) x),'[]'::jsonb),
 'devices',coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM (SELECT * FROM device ORDER BY count DESC,name LIMIT 50) x),'[]'::jsonb),
 'dropoffs',coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM (SELECT * FROM dropoff ORDER BY count DESC,name LIMIT 50) x),'[]'::jsonb),
 'campaigns',coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM (SELECT * FROM campaign ORDER BY visits DESC,name LIMIT 100) x),'[]'::jsonb),
 'retention',(SELECT coalesce(jsonb_agg(jsonb_build_object('date',to_char(d.day_date,'YYYY-MM-DD'),'players',coalesce(c.players,0),'eligible',coalesce(c.eligible,0),'returned',coalesce(c.returned,0),'rate',CASE WHEN c.eligible>0 THEN c.returned::numeric/c.eligible ELSE NULL END) ORDER BY d.day_date),'[]'::jsonb) FROM trend_days d LEFT JOIN (SELECT (first_at AT TIME ZONE 'UTC')::date AS day_date,count(*) players,count(*) FILTER(WHERE first_at+interval '48 hours'<=$4::timestamptz) eligible,count(*) FILTER(WHERE first_at+interval '48 hours'<=$4::timestamptz AND came_back) returned FROM cohort GROUP BY 1) c ON c.day_date=d.day_date),
 'heatmap',coalesce((SELECT jsonb_agg(jsonb_build_object('gameId',game_id,'surface',surface,'screen',screen,'device',device,'bx',bx,'by',by,'x',bx/20.0+0.025,'y',by/20.0+0.025,'count',count)) FROM (SELECT * FROM heat ORDER BY game_id,surface,screen,device,bx,by LIMIT 4000) h),'[]'::jsonb),
 'coverage',jsonb_build_object('countries',jsonb_build_object('shown',least(50,(SELECT count(*) FROM country)),'total',(SELECT count(*) FROM country)),'sources',jsonb_build_object('shown',least(50,(SELECT count(*) FROM source)),'total',(SELECT count(*) FROM source)),'devices',jsonb_build_object('shown',least(50,(SELECT count(*) FROM device)),'total',(SELECT count(*) FROM device)),'dropoffs',jsonb_build_object('shown',least(50,(SELECT count(*) FROM dropoff)),'total',(SELECT count(*) FROM dropoff)),'campaigns',jsonb_build_object('shown',least(100,(SELECT count(*) FROM campaign)),'total',(SELECT count(*) FROM campaign)),'heatmap',jsonb_build_object('shown',least(4000,(SELECT count(*) FROM heat)),'total',(SELECT count(*) FROM heat)))
 ) data`,[...params,startDay,days]),querySessionPage(workspace,gameId,days,{now})]);
 const data=result[0].data;
 data.lastEventAt=data.lastEventAt?date(data.lastEventAt):null;
 return {...data,windowEnd:new Date(now).toISOString(),sessionsList:page.sessions,sessionPage:{total:page.total,limit:page.limit,nextCursor:page.nextCursor}} as Analytics;
}

export type InvestigationFilter =
 | { kind: "heatmap"; gameId: string; surface: "game" | "viewport"; screen: string; device: string; bx: number; by: number }
 | { kind: "dropoff"; gameId: string; dropoff: string };
export type InvestigationMatch = { session: SessionSummary; evidence: { eventId: string; name: string; timestamp: string; replay?: { captureId: string; offsetSeconds: number; segment?: number } } };
/** Returns at most 50 owner-visible sessions. The event window and dimensions match analytics. */
export async function investigateSessions(workspace: string, filter: InvestigationFilter, days: number, end = Date.now()) {
 const params = windowParams(workspace,filter.gameId,days,end);
 type MatchRow = SessionRow & { event_id:string; event_name:string; event_at:string|Date };
 const selection = filter.kind === "heatmap"
  ? `, ${pointerCte}, matches AS (
       SELECT DISTINCT ON (session_id) session_id,id event_id,occurred_at event_at FROM pointer_data
       WHERE x BETWEEN 0 AND 1 AND y BETWEEN 0 AND 1 AND surface=$5 AND screen=$6 AND device=$7
       AND least(19,floor(x*20))::int=$8 AND least(19,floor(y*20))::int=$9
       ORDER BY session_id,occurred_at DESC,id DESC
     )
     SELECT s.*,m.event_id,'pointer'::text event_name,m.event_at FROM sessions s JOIN matches m USING(session_id)
     ORDER BY m.event_at DESC,s.session_id ASC LIMIT 51`
  : `, selected AS (SELECT * FROM sessions WHERE NOT completed AND ${dropoffName}=$5 ORDER BY last_at DESC,session_id ASC LIMIT 51)
      SELECT s.*,event.id event_id,event.name event_name,event.occurred_at event_at FROM selected s
      JOIN LATERAL (SELECT h.id,h.name,h.occurred_at FROM events h WHERE h.workspace_id=$1 AND h.game_id=s.game_id AND h.session_id=s.session_id AND h.kind='human'
        AND h.occurred_at >= $3::timestamptz AND h.occurred_at <= $4::timestamptz AND h.received_at <= $4::timestamptz
        ORDER BY CASE WHEN h.name='progression' AND jsonb_typeof(h.properties->'step')='string' AND h.properties->>'step'=s.last_step THEN 0 WHEN h.name NOT IN ('pointer','exit','active_play') THEN 1 ELSE 2 END,h.occurred_at DESC,h.id DESC LIMIT 1) event ON true
      ORDER BY s.last_at DESC,s.session_id ASC`;
 const filterParams = filter.kind === "heatmap" ? [filter.surface,filter.screen,filter.device,filter.bx,filter.by] : [filter.dropoff];
 const rows = await query<MatchRow>(`${sessionsCte}${selection}`,[...params,...filterParams]);
 const page = rows.slice(0,50);
 const sessions = await addCaptureStatus(workspace,page.map(session));
 const captures = page.length ? await query<{game_id:string;session_id:string;body:SessionCapture}>(`
   SELECT p.game_id,p.session_id,r.body FROM jsonb_to_recordset($2::jsonb) AS p(game_id text,session_id text)
   JOIN LATERAL (SELECT body FROM records WHERE workspace_id=$1 AND kind='session_capture' AND body->>'gameId'=p.game_id AND body->>'sessionId'=p.session_id ORDER BY updated_at DESC LIMIT 4) r ON true`,
   [workspace,JSON.stringify(page.map(r=>({game_id:r.game_id,session_id:r.session_id})))]) : [];
 const results: InvestigationMatch[] = page.map((row,index) => {
   const timestamp=date(row.event_at), at=Date.parse(timestamp);
   const capture=captures.find(({game_id,session_id,body:c}) => game_id===row.game_id && session_id===row.session_id && c.status==='ready' && !!c.videoUrl && !!c.recordedAt && typeof c.durationSeconds==='number' && c.durationSeconds>0 && Date.parse(c.expiresAt)>Date.now() && at>=Date.parse(c.recordedAt) && at<=Date.parse(c.recordedAt)+c.durationSeconds*1000)?.body;
   return {session:sessions[index],evidence:{eventId:row.event_id,name:row.event_name,timestamp,...(capture ? {replay:{captureId:capture.id,offsetSeconds:(at-Date.parse(capture.recordedAt!))/1000,...(capture.segment===undefined?{}:{segment:capture.segment})}}:{})}};
 });
 return {results,hasMore:rows.length>50,windowStart:params[2],windowEnd:params[3]};
}
