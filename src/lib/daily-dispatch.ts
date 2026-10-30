import { get, put, query } from './db';
import { bearer } from './security';
import { drainResearch } from './research-jobs';
import { duePublications } from './publishing';
import { cleanupCaptures } from './session-capture';
import { drainProfile, queueHumanProfileRefresh } from './game-profile';
import { tickAutomation } from './game-automation';
import { drainContentAutomation } from './content-automation';

type DispatchRecord = { id:'latest'; day:string; updatedAt:string; error?:string };
import type { DailyDispatchStatus } from './types';
export type { DailyDispatchStatus } from './types';
export const dailyAuthorized = (request:Request) => bearer(request,'CRON_SECRET');

// Keep the same deterministic job IDs and payloads as queueDailyResearch, in
// one bounded SQL statement suitable for a 30-second scheduler invocation.
// Lock the active parents before inserting so archive cannot miss phantom jobs.
export async function enqueueDailyDispatch(day = new Date().toISOString().slice(0,10)) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error('Invalid daily dispatch date');
  await query(`WITH active AS MATERIALIZED (
      SELECT id,workspace_id FROM records WHERE kind='game' AND (body->>'dailyEnabled')::boolean=true
      ORDER BY workspace_id,id FOR UPDATE
    ) INSERT INTO jobs(id,workspace_id,kind,state,body)
    SELECT 'research:' || $1 || ':' || id,workspace_id,'research','queued',jsonb_build_object('gameId',id,'day',$1::text)
    FROM active
    ON CONFLICT DO NOTHING`, [day]);
  await query(`INSERT INTO records(workspace_id,kind,id,body)
    SELECT DISTINCT workspace_id,'daily_dispatch','latest',jsonb_build_object('id','latest','day',$1::text,'updatedAt',$2::text)
    FROM records WHERE kind='game' AND (body->>'dailyEnabled')::boolean=true
    ON CONFLICT(workspace_id,kind,id) DO UPDATE SET body=excluded.body,updated_at=now()
    WHERE records.body->>'day' < $1`, [day,new Date().toISOString()]);
}

// Derive live progress from the authoritative jobs and research runs. This
// stays accurate when a separate worker finishes jobs after the consumer exits.
export async function dailyDispatchStatus(workspace:string):Promise<DailyDispatchStatus|undefined> {
  const dispatch=await get<DispatchRecord>(workspace,'daily_dispatch','latest');
  if (!dispatch) return;
  const rows=await query<{ state:string; run_status:string|null; run_at:string|null }>(`SELECT j.state,r.body->>'status' AS run_status,coalesce(r.body->>'finishedAt',r.body->>'startedAt') AS run_at FROM jobs j
    LEFT JOIN daily_runs d ON d.workspace_id=j.workspace_id AND d.game_id=j.body->>'gameId' AND d.day=j.body->>'day'
    LEFT JOIN records r ON r.workspace_id=j.workspace_id AND r.kind='run' AND r.id=d.run_id
    WHERE j.workspace_id=$1 AND j.kind='research' AND j.body->>'day'=$2`,[workspace,dispatch.day]);
  let completed=0,partial=0,failed=0,remaining=0,running=false; let lastRunAt:string|undefined;
  for (const row of rows) {
    if (row.run_at && (!lastRunAt || row.run_at>lastRunAt)) lastRunAt=row.run_at;
    if (row.state==='failed' || row.run_status==='failed') failed++;
    else if (row.state!=='complete') {remaining++; if(row.state==='claimed')running=true;}
    else if (row.run_status==='complete') completed++;
    else partial++;
  }
  const state=dispatch.error?'failed':remaining?(running?'running':'queued'):failed?'failed':partial?'partial':'completed';
  return {day:dispatch.day,state,total:rows.length,completed,partial,failed,remaining,updatedAt:dispatch.updatedAt,...(lastRunAt?{lastRunAt}:{}),...(dispatch.error?{error:dispatch.error}:{})};
}
async function recordFailure(day:string) {
  await query(`UPDATE records SET body=jsonb_set(jsonb_set(body,'{error}',to_jsonb($2::text),true),'{updatedAt}',to_jsonb($3::text),true),updated_at=now() WHERE kind='daily_dispatch' AND id='latest' AND body->>'day'=$1`,[day,'Daily processing failed; queued work can be retried.',new Date().toISOString()]);
}
async function clearFailure(day:string) {
  await query(`UPDATE records SET body=(body - 'error') || jsonb_build_object('updatedAt',$2::text),updated_at=now() WHERE kind='daily_dispatch' AND id='latest' AND body->>'day'=$1`,[day,new Date().toISOString()]);
}
export async function dispatchDailyRequest() {
  if (process.env.BLAZE_LEGACY_DAILY_ENABLED !== "true") return { paused: true };
  const day=new Date().toISOString().slice(0,10);
  await enqueueDailyDispatch(day);
  try {
    const configured=process.env.DEPLOY_PRIME_URL || process.env.URL;
    if (!configured || !process.env.CRON_SECRET?.trim()) throw new Error('Daily dispatch is not configured');
    const base=new URL(configured);
    if (base.protocol!=='https:' || base.username || base.password || base.search || base.hash || base.pathname!=='/') throw new Error('Invalid deployment origin');
    const response=await fetch(new URL('/.netlify/functions/blaze-daily-consumer',base),{method:'POST',headers:{Authorization:`Bearer ${process.env.CRON_SECRET}`},redirect:'error',signal:AbortSignal.timeout(10000)});
    if (response.status!==202) throw new Error('Background dispatch was not accepted');
  } catch (error) { await recordFailure(day); throw error; }
}

// Existing daily maintenance, executed outside the scheduled 30-second limit.
async function dailyMaintenance() {
  await query(`DELETE FROM rate_windows WHERE expires_at<now()`);
  await query(`DELETE FROM auth_sessions WHERE expires_at<now()`);
  await cleanupCaptures();
  if (process.env.APP_URL) {
    const games=await query<{workspace_id:string;id:string}>(`SELECT g.workspace_id,g.id FROM records g LEFT JOIN records m ON m.workspace_id=g.workspace_id AND m.kind='profile_human_refresh' AND m.id=g.id WHERE g.kind='game' AND (m.id IS NULL OR m.updated_at<now()-interval '24 hours') AND EXISTS (SELECT 1 FROM events e WHERE e.workspace_id=g.workspace_id AND e.game_id=g.id AND e.kind='human' AND e.received_at>coalesce(m.updated_at,'epoch'::timestamptz)) ORDER BY coalesce(m.updated_at,'epoch'::timestamptz),g.workspace_id,g.id LIMIT 5`);
    for (const game of games) await queueHumanProfileRefresh(game.workspace_id,game.id,process.env.APP_URL);
  }
  await tickAutomation();
  await duePublications();
  await Promise.all([drainProfile(),drainContentAutomation()]);
}
export async function consumeDailyDispatch() {
  if (process.env.BLAZE_LEGACY_DAILY_ENABLED !== "true") return { paused: true };
  const day=new Date().toISOString().slice(0,10), leaseId=`daily-consumer:${day}`;
  const lease=await query(`INSERT INTO jobs(id,workspace_id,kind,state,body,lease_until) VALUES($1,'system','daily_consumer','claimed','{}',now()+interval '14 minutes') ON CONFLICT(id) DO UPDATE SET state='claimed',lease_until=excluded.lease_until,updated_at=now() WHERE jobs.lease_until<now() OR jobs.state='failed' RETURNING id`,[leaseId]);
  if (!lease.length) return;
  try {
    const stop=Date.now()+10*60000;
    await clearFailure(day);
    await dailyMaintenance();
    for (let batch=0;batch<20 && Date.now()<stop;batch++) {
      const results=await Promise.all([drainResearch(1),drainResearch(1),drainResearch(1)]);
      if (results.every(result=>result.length===0)) {
        const remaining=await query(`SELECT id FROM jobs WHERE kind='research' AND available_at<=now() AND (state='queued' OR (state='claimed' AND lease_until<now())) LIMIT 1`);
        if (!remaining.length) break;
      }
    }
    // Allow a later invocation to continue queued work; research leases and
    // deterministic job keys keep duplicate invocations safe.
    await query(`UPDATE jobs SET state='complete',lease_until=now(),updated_at=now() WHERE id=$1`,[leaseId]);
  } catch (error) {
    await recordFailure(day).catch(()=>{});
    await query(`UPDATE jobs SET state='failed',lease_until=now(),updated_at=now() WHERE id=$1`,[leaseId]).catch(()=>{});
    throw error;
  }
}
