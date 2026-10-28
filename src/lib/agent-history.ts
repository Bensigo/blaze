import { query } from "./db";
import type { Finding, Measurement, Post } from "./types";

// These projections intentionally exclude session/player IDs, credentials and capture data.
export async function loadAgentHistory(workspace: string, gameId: string) {
  const [
    daily,
    campaigns,
    summary,
    postRecords,
    findingRecords,
    measurementRecords,
  ] = await Promise.all([
    query<{
      day: string;
      visits: number;
      loaded: number;
      first_actions: number;
      starts: number;
      completions: number;
      last_event: string;
    }>(
      `
      WITH sessions AS (
        SELECT session_id, min(occurred_at) AS started, max(occurred_at) AS last_event,
          bool_or(name='loaded') AS loaded, bool_or(name='first_action') AS first_action,
          bool_or(name='round_start') AS started_round, bool_or(name='round_complete') AS completed
        FROM events WHERE workspace_id=$1 AND game_id=$2 AND kind='human'
          AND occurred_at>=now()-interval '90 days' AND occurred_at<=now() GROUP BY session_id
      ) SELECT to_char(started AT TIME ZONE 'UTC','YYYY-MM-DD') AS day, count(*)::int AS visits,
        count(*) FILTER (WHERE loaded)::int AS loaded, count(*) FILTER (WHERE first_action)::int AS first_actions,
        count(*) FILTER (WHERE started_round)::int AS starts, count(*) FILTER (WHERE completed)::int AS completions,
        max(last_event)::text AS last_event FROM sessions GROUP BY 1 ORDER BY 1 LIMIT 91`,
      [workspace, gameId],
    ),
    query<{
      name: string;
      visits: number;
      starts: number;
      completions: number;
      returns: number;
    }>(
      `
      WITH sessions AS (
        SELECT session_id, player_id, min(occurred_at) AS started,
          (array_agg(campaign ORDER BY occurred_at))[1] AS campaign,
          bool_or(name='round_start') AS started_round, bool_or(name='round_complete') AS completed
        FROM events WHERE workspace_id=$1 AND game_id=$2 AND kind='human'
          AND occurred_at>=now()-interval '90 days' AND occurred_at<=now() GROUP BY session_id, player_id
      ), marked AS (SELECT *, min(started) OVER (PARTITION BY player_id) AS first_seen FROM sessions)
      SELECT campaign AS name, count(*)::int AS visits, count(*) FILTER (WHERE started_round)::int AS starts,
        count(*) FILTER (WHERE completed)::int AS completions,
        count(DISTINCT player_id) FILTER (WHERE started>=first_seen+interval '24 hours')::int AS returns
      FROM marked WHERE campaign<>'' GROUP BY campaign ORDER BY visits DESC LIMIT 50`,
      [workspace, gameId],
    ),
    query<{ players: number; returns: number }>(
      `WITH sessions AS (
      SELECT session_id,player_id,min(occurred_at) AS started FROM events
      WHERE workspace_id=$1 AND game_id=$2 AND kind='human' AND occurred_at>=now()-interval '90 days' AND occurred_at<=now() GROUP BY session_id,player_id
      ), marked AS (SELECT *,min(started) OVER (PARTITION BY player_id) AS first_seen FROM sessions)
      SELECT count(DISTINCT player_id)::int AS players, count(DISTINCT player_id) FILTER (WHERE started>=first_seen+interval '24 hours')::int AS returns FROM marked`,
      [workspace, gameId],
    ),
    ...(["post", "finding", "measurement"] as const).map((kind) =>
      query<{ kind: string; body: Post | Finding | Measurement }>(
        `SELECT kind,body FROM records
      WHERE workspace_id=$1 AND kind=$2 AND body->>'gameId'=$3 AND updated_at>=now()-interval '90 days'
      ORDER BY updated_at DESC LIMIT $4`,
        [workspace, kind, gameId, kind === "measurement" ? 15 : 30],
      ),
    ),
  ]);
  const records = [...postRecords, ...findingRecords, ...measurementRecords];
  const posts = records
    .filter((r) => r.kind === "post")
    .slice(0, 30)
    .map(({ body }) => {
      const p = body as Post;
      return {
        channel: p.channel,
        text: String(p.text || "").slice(0, 1000),
        status: p.status,
        createdAt: p.createdAt,
        campaignId: p.campaignId,
        observedCampaignTraffic:
          campaigns.find((c) => c.name === p.campaignId) || null,
      };
    });
  const findings = records
    .filter(
      (r) =>
        r.kind === "finding" &&
        !(r.body as Finding).evidence?.some((e) => e.recordingId),
    )
    .slice(0, 30)
    .map(({ body }) => {
      const f = body as Finding;
      const safe = (v: string) =>
        String(v || "")
          .replace(/https?:\/\/\S+|\/api\/sessions\/\S+/gi, "[link omitted]")
          .replace(
            /\b(?:session|recording)_[\w-]+\b/gi,
            "[identifier omitted]",
          );
      return {
        title: safe(f.title).slice(0, 200),
        detail: safe(f.detail).slice(0, 600),
        type: f.type,
        status: f.status,
        evidence: f.evidence
          .filter(
            (e) =>
              !e.recordingId &&
              !e.url?.startsWith("/api/sessions/") &&
              !/human session/i.test(e.label),
          )
          .map((e) => ({ label: e.label.slice(0, 160) }))
          .slice(0, 3),
        createdAt: f.createdAt,
      };
    });
  const measurements = await Promise.all(
    records
      .filter((r) => r.kind === "measurement")
      .slice(0, 15)
      .map(async ({ body }) => {
        const m = body as Measurement;
        const [after] = await query<{
          sessions: number;
          starts: number;
          completions: number;
          error_sessions: number;
        }>(
          `
      WITH s AS (SELECT session_id, bool_or(name='round_start') AS starts, bool_or(name='round_complete') AS completions, bool_or(name='error') AS errors
        FROM events WHERE workspace_id=$1 AND game_id=$2 AND kind='human' AND occurred_at >= $3::timestamptz
          AND occurred_at < LEAST(now(), $3::timestamptz + interval '14 days') GROUP BY session_id)
      SELECT count(*)::int AS sessions,count(*) FILTER (WHERE starts)::int AS starts,
        count(*) FILTER (WHERE completions)::int AS completions,count(*) FILTER (WHERE errors)::int AS error_sessions FROM s`,
          [workspace, gameId, m.startedAt],
        );
        return {
          note: String(m.note || "").slice(0, 500),
          startedAt: m.startedAt,
          baseline: {
            sessions: m.baseline.sessions,
            starts: m.baseline.starts,
            completions: m.baseline.completions,
            errorSessions: m.baseline.errorSessions,
          },
          after: {
            sessions: after.sessions,
            starts: after.starts,
            completions: after.completions,
            errorSessions: after.error_sessions,
          },
          daysObserved: Math.max(
            0,
            Math.min(
              14,
              (Date.now() - new Date(m.startedAt).getTime()) / 86400000,
            ),
          ),
        };
      }),
  );
  const now = Date.now();
  const windowCounts = (startDays: number, endDays: number) =>
    daily
      .filter((d) => {
        const age = (now - new Date(`${d.day}T00:00:00Z`).getTime()) / 86400000;
        return age >= endDays && age < startDays;
      })
      .reduce(
        (a, d) => ({
          visits: a.visits + d.visits,
          starts: a.starts + d.starts,
          completions: a.completions + d.completions,
        }),
        { visits: 0, starts: 0, completions: 0 },
      );
  return {
    comparison: {
      current30Days: windowCounts(30, 0),
      prior30Days: windowCounts(60, 30),
      note: "UTC calendar-day buckets; the current day is partial. Counts are observational, and small samples limit comparisons.",
    },
    players: summary[0].players,
    returns: summary[0].returns,
    window: "Latest 90 days through now (UTC); human telemetry only",
    lastEventAt: daily.length
      ? daily.reduce((a, b) => (a.last_event > b.last_event ? a : b)).last_event
      : null,
    trend: daily.map(({ day, visits, starts, completions }) => ({
      day,
      visits,
      starts,
      completions,
    })),
    totals: daily.reduce(
      (a, d) => ({
        visits: a.visits + d.visits,
        starts: a.starts + d.starts,
        completions: a.completions + d.completions,
      }),
      { visits: 0, starts: 0, completions: 0 },
    ),
    funnel: [
      { name: "Sessions", count: daily.reduce((a, d) => a + d.visits, 0) },
      { name: "Loaded", count: daily.reduce((a, d) => a + d.loaded, 0) },
      {
        name: "First action",
        count: daily.reduce((a, d) => a + d.first_actions, 0),
      },
      { name: "Round start", count: daily.reduce((a, d) => a + d.starts, 0) },
      {
        name: "Round complete",
        count: daily.reduce((a, d) => a + d.completions, 0),
      },
    ],
    campaigns,
    posts,
    findings,
    measurements,
    limitations: [
      "Funnel counts show sessions containing each event, not an ordered conversion funnel. Counts are observational; small samples and incomplete instrumentation limit inference.",
      "Returns are distinct players returning at least 24 hours after their first observed session within the window, not a mature retention cohort.",
      "Campaign counts are observed campaign traffic, not attributable improvement after publication; publication time is unavailable.",
      "Stored post text includes human edits and can inform style. Unpublished posts are neither successes nor evidence of rejection or failure. Social impressions and likes are unavailable.",
      "A resolved finding does not prove a change worked; measured before/after counts are observational.",
      "Correlation does not establish causation. Results and records are capped.",
    ],
  };
}
export type AgentHistory = Awaited<ReturnType<typeof loadAgentHistory>>;
