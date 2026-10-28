import { query } from "./db";
import type { MeasurementMetrics, MeasurementRelease, MeasurementWindow } from "./types";

const DAY = 86400000;
const utc = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
function instant(value: unknown): number {
  if (typeof value !== "string" || !utc.test(value)) throw new Error("Times must be explicit UTC timestamps");
  const n = Date.parse(value);
  if (!Number.isFinite(n) || new Date(n).toISOString().slice(0, 19) !== value.slice(0, 19)) throw new Error("Invalid UTC timestamp");
  return n;
}
export function validateMeasurementWindows(release: MeasurementRelease, baseline: MeasurementWindow, followup: MeasurementWindow, now = Date.now()) {
  if (!release || !baseline || !followup || !Number.isFinite(now)) throw new Error("Release and both windows are required");
  const fields = [release.version, release.description];
  if (fields.some(v => typeof v !== "string" || v.trim().length < 1 || v.length > 500)) throw new Error("Release version and description are required");
  try { const u = new URL(release.evidenceUrl); if (u.protocol !== "https:" || u.username || u.password || release.evidenceUrl.length > 2000) throw 0; } catch { throw new Error("A valid HTTPS release evidence URL is required"); }
  const t = instant(release.effectiveAt), bs = instant(baseline.start), be = instant(baseline.end), fs = instant(followup.start), fe = instant(followup.end);
  if (t > now) throw new Error("Actual release cannot be in the future");
  if (bs >= be || fs >= fe || be > fs || be > t || fs < t || be > now || be-bs > 90*DAY || fe-fs > 90*DAY) throw new Error("Invalid or overlapping measurement windows");
  return { t, bs, be, fs, fe };
}

// Matches the dashboard's human-only session, active-play and first-seen definitions.
// Each window is half-open; returns use the all-time human first-seen index.
export async function measurementMetrics(workspace: string, gameId: string, start: string, end: string, asOf: string): Promise<MeasurementMetrics> {
 const rows = await query<{data: MeasurementMetrics}>(`
 WITH human AS MATERIALIZED (
   SELECT * FROM events WHERE workspace_id=$1 AND game_id=$2 AND kind='human'
     AND occurred_at >= $3::timestamptz AND occurred_at < $4::timestamptz AND received_at <= $5::timestamptz
 ), numbered AS (
   SELECT *,row_number() OVER (PARTITION BY game_id,session_id ORDER BY occurred_at,id) seq FROM human
 ), activity AS (
   SELECT *,max(seq) FILTER (WHERE name='round_start') OVER (PARTITION BY game_id,session_id ORDER BY seq ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING) last_start,
     max(seq) FILTER (WHERE name IN ('round_complete','exit')) OVER (PARTITION BY game_id,session_id ORDER BY seq ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING) last_stop FROM numbered
 ), grouped AS (
   SELECT session_id,(array_agg(player_id ORDER BY occurred_at,id))[1] player_id,
     (array_agg(source ORDER BY occurred_at,id))[1] source,(array_agg(device ORDER BY occurred_at,id))[1] device,
     min(occurred_at) started_at,array_agg(name ORDER BY occurred_at,id) names,
     bool_or(name='round_start') started,bool_or(name='round_complete') completed,bool_or(name='error') errors,
     sum(CASE WHEN name='active_play' AND last_start IS NOT NULL AND last_start>coalesce(last_stop,0) AND jsonb_typeof(properties->'duration')='number'
       THEN greatest(0,least(15,(properties->>'duration')::numeric)) ELSE NULL END) active_seconds
   FROM activity GROUP BY session_id
 ), p AS (SELECT *,array_position(names,'visit') v FROM grouped),
 p2 AS (SELECT *,CASE WHEN v IS NOT NULL THEN array_position(names,'loaded',v+1) END l FROM p),
 s AS (SELECT *,CASE WHEN l IS NOT NULL THEN array_position(names,'round_start',l+1) END ordered_start FROM p2),
 cohort AS (
   SELECT f.*,EXISTS(SELECT 1 FROM events e WHERE e.workspace_id=f.workspace_id AND e.game_id=f.game_id AND e.player_id=f.player_id AND e.kind='human' AND e.name='visit' AND e.session_id<>f.first_session_id AND e.occurred_at>=f.first_at+interval '24 hours' AND e.occurred_at<f.first_at+interval '48 hours' AND e.occurred_at<=$5::timestamptz AND e.received_at<=$5::timestamptz) came_back
   FROM player_first_seen f WHERE f.workspace_id=$1 AND f.game_id=$2 AND f.first_at >= $3::timestamptz AND f.first_at < $4::timestamptz
 ), src AS (SELECT coalesce(nullif(source,''),'Unknown') name,count(*)::int count FROM s GROUP BY 1),
 dev AS (SELECT coalesce(nullif(device,''),'Unknown') name,count(*)::int count FROM s GROUP BY 1)
 SELECT jsonb_build_object(
 'players',(SELECT count(DISTINCT player_id) FROM s),'sessions',(SELECT count(*) FROM s),
 'starts',(SELECT count(*) FROM s WHERE started),'completions',(SELECT count(*) FROM s WHERE completed),'errorSessions',(SELECT count(*) FROM s WHERE errors),
 'activePlay',jsonb_build_object('totalSeconds',(SELECT sum(active_seconds) FROM s),'measuredSessions',(SELECT count(*) FROM s WHERE active_seconds IS NOT NULL),'eligibleSessions',(SELECT count(*) FROM s WHERE started)),
 'completion',jsonb_build_object('numerator',(SELECT count(*) FROM s WHERE started AND completed),'denominator',(SELECT count(*) FROM s WHERE started),'rate',(SELECT count(*) FILTER(WHERE started AND completed)::numeric/nullif(count(*) FILTER(WHERE started),0) FROM s)),
 'conversion',jsonb_build_object('numerator',(SELECT count(*) FROM s WHERE ordered_start IS NOT NULL),'denominator',(SELECT count(*) FROM s WHERE v IS NOT NULL),'rate',(SELECT count(*) FILTER(WHERE ordered_start IS NOT NULL)::numeric/nullif(count(*) FILTER(WHERE v IS NOT NULL),0) FROM s)),
 'returningPlayers',(SELECT count(DISTINCT s.player_id) FROM s JOIN player_first_seen f ON f.workspace_id=$1 AND f.game_id=$2 AND f.player_id=s.player_id WHERE s.session_id<>f.first_session_id AND s.started_at>=f.first_at+interval '24 hours'),
 'd1',jsonb_build_object('cohortPlayers',(SELECT count(*) FROM cohort),'eligible',(SELECT count(*) FROM cohort WHERE first_at+interval '48 hours'<=$5::timestamptz),'returned',(SELECT count(*) FROM cohort WHERE first_at+interval '48 hours'<=$5::timestamptz AND came_back),'rate',(SELECT count(*) FILTER(WHERE first_at+interval '48 hours'<=$5::timestamptz AND came_back)::numeric/nullif(count(*) FILTER(WHERE first_at+interval '48 hours'<=$5::timestamptz),0) FROM cohort)),
 'sources',coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM (SELECT * FROM src ORDER BY count DESC,name LIMIT 20) x),'[]'::jsonb),
 'devices',coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM (SELECT * FROM dev ORDER BY count DESC,name LIMIT 20) x),'[]'::jsonb)
 ) data`, [workspace,gameId,start,end,asOf]);
 return rows[0].data;
}
