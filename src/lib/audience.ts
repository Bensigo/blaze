import {query} from './db';

export type Audience={browserIds:number;unlinkedGameBrowserIds:number;segments:{name:string;count:number}[];countries:{name:string;count:number}[];ageBands:{name:string;count:number}[];declaredCountries:{name:string;count:number}[];interests:{name:string;count:number}[];profileRespondents:number};
/** Explicit shared scopes join across games; unscoped IDs remain game-specific. No raw IDs leave this aggregate. */
export async function audience(workspace:string,gameId:string|undefined,days:number,now:number):Promise<Audience>{
 const rows=await query<{data:Audience}>(`WITH eligible AS (
 SELECT e.* FROM events e WHERE e.workspace_id=$1 AND ($2::text IS NULL OR e.game_id=$2) AND e.kind='human'
 AND e.occurred_at BETWEEN $3::timestamptz AND $4::timestamptz AND e.received_at<=$4::timestamptz
 AND NOT EXISTS(SELECT 1 FROM events t WHERE t.workspace_id=e.workspace_id AND t.game_id=e.game_id AND t.session_id=e.session_id AND (t.kind='agent' OR t.properties @> '{"test":true}' OR t.properties @> '{"fixture":true}' OR t.properties @> '{"isTest":true}' OR t.properties @> '{"isFixture":true}' OR t.properties->>'traffic' IN ('test','fixture')))
 ), scoped AS (SELECT eligible.*,CASE WHEN left(player_id,7)='scoped_' THEN player_id ELSE game_id || ':' || player_id END audience_id FROM eligible),
 people AS (SELECT audience_id AS player_id,count(*) FILTER(WHERE name='round_start') starts,bool_or(name='round_complete') completed,count(DISTINCT game_id) FILTER(WHERE name='round_start') games,(array_agg(country ORDER BY occurred_at,id))[1] country,min(occurred_at) first_at FROM scoped GROUP BY audience_id),
 profiles AS (SELECT DISTINCT ON(audience_id) audience_id AS player_id,properties FROM scoped WHERE name='player_profile' ORDER BY audience_id,occurred_at DESC,id DESC),
 segments AS (
 SELECT 'Browse only' name,count(*)::int count FROM people WHERE starts=0 UNION ALL
 SELECT '1–4 rounds',count(*)::int FROM people WHERE starts BETWEEN 1 AND 4 UNION ALL
 SELECT '5+ rounds',count(*)::int FROM people WHERE starts>=5 UNION ALL
 SELECT 'Multiple games',count(*)::int FROM people WHERE games>=2 UNION ALL
 SELECT 'Completed a round',count(*)::int FROM people WHERE completed UNION ALL
 SELECT 'Returning browser',count(*)::int FROM people p WHERE EXISTS(SELECT 1 FROM events e WHERE e.workspace_id=$1 AND ($2::text IS NULL OR e.game_id=$2) AND e.kind='human' AND (CASE WHEN left(e.player_id,7)='scoped_' THEN e.player_id ELSE e.game_id || ':' || e.player_id END)=p.player_id AND e.occurred_at<$3::timestamptz AND e.received_at<=$4::timestamptz AND NOT EXISTS(SELECT 1 FROM events t WHERE t.workspace_id=e.workspace_id AND t.game_id=e.game_id AND t.session_id=e.session_id AND (t.kind='agent' OR t.properties @> '{"test":true}' OR t.properties @> '{"fixture":true}' OR t.properties @> '{"isTest":true}' OR t.properties @> '{"isFixture":true}' OR t.properties->>'traffic' IN ('test','fixture'))))
 ), geo AS(SELECT coalesce(nullif(country,''),'Unknown') name,count(*)::int count FROM people GROUP BY 1),
 ages AS(SELECT properties->>'age_band' name,count(*)::int count FROM profiles WHERE properties->>'age_band' IN ('18-24','25-34','35-44','45-54','55-plus') GROUP BY 1),
 declared AS(SELECT properties->>'declared_country' name,count(*)::int count FROM profiles WHERE properties->>'declared_country' ~ '^[A-Z]{2}$' GROUP BY 1),
 interests AS(SELECT interest name,count(DISTINCT player_id)::int count FROM profiles CROSS JOIN LATERAL unnest(string_to_array(properties->>'interests',',')) interest WHERE interest IN ('action','sports','cards','puzzle','rhythm','trivia','party') GROUP BY 1)
 SELECT jsonb_build_object('browserIds',(SELECT count(*) FROM people),'unlinkedGameBrowserIds',(SELECT count(DISTINCT(game_id,player_id)) FROM eligible WHERE left(player_id,7)<>'scoped_'),
 'profileRespondents',(SELECT count(*) FROM profiles WHERE properties->>'age_band'<>'unknown' OR properties->>'declared_country'<>'unknown' OR properties->>'interests'<>'unknown'),
 'segments',(SELECT coalesce(jsonb_agg(to_jsonb(s)),'[]') FROM segments s),
 'countries',(SELECT coalesce(jsonb_agg(to_jsonb(s)),'[]') FROM (SELECT * FROM geo ORDER BY count DESC,name LIMIT 300)s),
 'ageBands',(SELECT coalesce(jsonb_agg(to_jsonb(s)),'[]') FROM (SELECT * FROM ages ORDER BY name)s),
 'declaredCountries',(SELECT coalesce(jsonb_agg(to_jsonb(s)),'[]') FROM (SELECT * FROM declared ORDER BY count DESC,name LIMIT 100)s),
 'interests',(SELECT coalesce(jsonb_agg(to_jsonb(s)),'[]') FROM (SELECT * FROM interests ORDER BY count DESC,name)s)) data`,[workspace,gameId??null,new Date(now-days*86400000).toISOString(),new Date(now).toISOString()]);
 return rows[0].data;
}
