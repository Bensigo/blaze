/** Explicit opt-in live acceptance for the isolated web-game-marketing database. */
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { Pool } from "pg";

const release = "https://web-game-marketing.vercel.app";
if (
  process.env.ALLOW_LIVE_DB_ACCEPTANCE !== "true" ||
  process.env.RELEASE_BASE_URL !== release
) {
  throw new Error(
    "Explicit live acceptance opt-in and the exact release base URL are required.",
  );
}
// Load the database connection only from this product's private Vercel environment file.
const envFile = await readFile(resolve(".env.vercel.local"), "utf8");
const dbLine = envFile
  .split(/\r?\n/)
  .find((line) => line.startsWith("DATABASE_URL="));
if (!dbLine)
  throw new Error("Private release environment has no DATABASE_URL.");
let databaseUrl = dbLine.slice("DATABASE_URL=".length).trim();
if (databaseUrl.startsWith('"') && databaseUrl.endsWith('"'))
  databaseUrl = JSON.parse(databaseUrl);
if (!databaseUrl.startsWith("postgres"))
  throw new Error("Release database URL is invalid.");
process.env.DATABASE_URL = databaseUrl;
process.env.VERCEL = "1";
const { query, put, migrateDatabase, closeDatabase, postgresConnectionString } =
  await import("../src/lib/db");
const { ingest } = await import("../src/lib/telemetry");
const { hash } = await import("../src/lib/security");
const { sqlAnalytics, querySessionPage } =
  await import("../src/lib/analytics-sql");
const outDir =
  "/Users/macbook/Documents/Codex/2026-10-28/web-game-marketing-build/outputs";
const fixture = randomUUID().replaceAll("-", "");
const workspace = `acceptance_${fixture}`;
const ingestGame = `ingest_${fixture}`;
const bulkGame = `bulk_${fixture}`;
const sdkKey = `sdk_${fixture}`;
const started = Date.now();
const fixtureIp = "198.51.100.77";
const privateUrl = new URL(databaseUrl);
const redact = (message: string) =>
  [databaseUrl, privateUrl.hostname, privateUrl.username, privateUrl.password]
    .filter(Boolean)
    .reduce((text, secret) => text.replaceAll(secret, "[redacted]"), message);
const audit: Record<string, unknown> = {
  startedAt: new Date(started).toISOString(),
  stage: "start",
  completed: false,
  cleanupVerified: false,
};
let created = false;
let failed = false;
let plan: unknown;
const direct = new Pool({
  connectionString: postgresConnectionString(databaseUrl),
  max: 2,
  connectionTimeoutMillis: 10000,
  statement_timeout: 15000,
});
function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
const game = (id: string) => ({
  id,
  title: "Live acceptance fixture",
  url: "https://fixture.invalid",
  description: "",
  image: "",
  genre: "",
  sdkKey,
  origins: ["https://fixture.invalid"],
  createdAt: new Date().toISOString(),
  dailyEnabled: false,
  competitors: [],
});
const size = async () =>
  Number(
    (
      await query<{ bytes: string }>(
        "SELECT pg_database_size(current_database())::text AS bytes",
      )
    )[0].bytes,
  );
const counts = async () =>
  (
    await query<{ events: string; games: string }>(
      `SELECT (SELECT count(*) FROM events WHERE workspace_id<>$1)::text events, (SELECT count(*) FROM records WHERE kind='game' AND workspace_id<>$1)::text games`,
      [workspace],
    )
  )[0];
const report = (stage: string) => {
  audit.stage = stage;
  console.log(`Live database acceptance: ${stage}`);
};
try {
  report("baseline");
  const baselineSize = await size();
  const baseline = await counts();
  assert(
    baselineSize < 100_000_000,
    "Database exceeds acceptance size ceiling.",
  );
  assert(
    baseline.events === "0" && baseline.games === "0",
    "The expected empty dedicated database has changed.",
  );
  audit.baseline = {
    databaseBytes: baselineSize,
    events: Number(baseline.events),
    games: Number(baseline.games),
  };

  report("migration advisory lock");
  const holder = await direct.connect();
  let migration: Promise<void> | undefined;
  try {
    await holder.query("BEGIN");
    await holder.query("SELECT pg_advisory_xact_lock(744110219)");
    const holderPid = Number(
      (await holder.query("SELECT pg_backend_pid() AS pid")).rows[0].pid,
    );
    migration = migrateDatabase();
    migration.catch(() => undefined);
    let observed = false;
    const until = Date.now() + 7000;
    while (Date.now() < until) {
      const rows = await direct.query(
        `SELECT pid FROM pg_stat_activity WHERE wait_event_type='Lock' AND $1=ANY(pg_blocking_pids(pid))`,
        [holderPid],
      );
      if (rows.rowCount) {
        observed = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert(
      observed,
      "A migration waiting on the held advisory lock was not observed.",
    );
    audit.migrationLock = { observedWaitEventType: "Lock", serialized: true };
    await holder.query("COMMIT");
    await migration;
  } catch (error) {
    await holder.query("ROLLBACK").catch(() => undefined);
    if (migration) await migration.catch(() => undefined);
    throw error;
  } finally {
    holder.release();
  }

  report("statement timeout (approximately 15 seconds)");
  let timeoutCode = "";
  const timeoutStart = performance.now();
  try {
    await query("SELECT pg_sleep(30)");
  } catch (error) {
    timeoutCode = String((error as { code?: string }).code || "");
  }
  const timeoutMs = Math.round(performance.now() - timeoutStart);
  audit.statementTimeout = {sqlState: timeoutCode, elapsedMs: timeoutMs, recovery: false};
  assert(
    timeoutCode === "57014" && timeoutMs >= 13000 && timeoutMs < 22000,
    "Statement timeout did not cancel as expected.",
  );
  assert(
    (await query<{ ok: number }>("SELECT 1 AS ok"))[0].ok === 1,
    "Database did not recover after cancellation.",
  );
  audit.statementTimeout = {
    sqlState: timeoutCode,
    elapsedMs: timeoutMs,
    recovery: true,
  };

  report("batched ingestion and legacy writer");
  created = true;
  await put(workspace, "game", game(ingestGame));
  await put(workspace, "game", {
    ...game(bulkGame),
    sdkKey: `bulk_${fixture}`,
  });
  const fixtureNow = Date.now();
  const events = Array.from({ length: 50 }, (_, i) => ({
    id: `acceptance-event-${fixture}-${i}`,
    name: i % 2 ? "round_start" : "visit",
    sessionId: `session-${Math.floor(i / 10)}-${fixture}`,
    playerId: `player-${Math.floor(i / 10)}-${fixture}`,
    timestamp: new Date(fixtureNow + i).toISOString(),
    properties: {},
    page: "https://fixture.invalid",
    referrer: "",
  }));
  const makeRequest = () =>
    new Request(`${release}/api/collect`, {
      method: "POST",
      headers: {
        origin: "https://fixture.invalid",
        "x-forwarded-for": fixtureIp,
      },
      body: JSON.stringify({ sdkKey, events }),
    });
  const first = await ingest(makeRequest());
  const a = await first.json();
  const retry = await ingest(makeRequest());
  const b = await retry.json();
  assert(
    first.ok && a.accepted === 50 && retry.ok && b.accepted === 0,
    "Batch ingestion or idempotent retry failed.",
  );
  const legacyTime = new Date(fixtureNow - 86400000).toISOString();
  await query(
    `INSERT INTO events(id,workspace_id,game_id,session_id,player_id,kind,name,occurred_at,country,device,source,campaign,page,properties) VALUES($1,$2,$3,$4,$5,'human','visit',$6,'NG','desktop','fixture','','','{}')`,
    [
      `legacy_${fixture}`,
      workspace,
      ingestGame,
      `legacy_session_${fixture}`,
      events[0].playerId,
      legacyTime,
    ],
  );
  const firstSeen = await query<{ first_at: Date; first_session_id: string }>(
    "SELECT first_at,first_session_id FROM player_first_seen WHERE workspace_id=$1 AND game_id=$2 AND player_id=$3",
    [workspace, ingestGame, events[0].playerId],
  );
  assert(
    firstSeen.length === 1 &&
      new Date(firstSeen[0].first_at).toISOString() === legacyTime &&
      firstSeen[0].first_session_id === `legacy_session_${fixture}`,
    "Legacy insertion did not update first-seen.",
  );
  audit.ingestion = {
    submitted: 50,
    accepted: a.accepted,
    retryAccepted: b.accepted,
    legacyLateFirstSeen: true,
  };

  report("100,000-event fixture");
  const safeCounts = await counts();
  assert(
    safeCounts.events === baseline.events &&
      safeCounts.games === baseline.games,
    "Non-fixture records changed before bulk insertion.",
  );
  for (let chunk = 0; chunk < 10; chunk++) {
    await query(
      `WITH sessions AS (
      SELECT n, n%5000 AS player, now()-interval '29 days'+((n%27)::text||' days')::interval + CASE WHEN n>=5000 THEN interval '2 days' ELSE interval '0 days' END AS base
      FROM generate_series($3::int,$4::int) n
    ) INSERT INTO events(id,workspace_id,game_id,session_id,player_id,kind,name,occurred_at,country,device,source,campaign,page,properties)
    SELECT $5||':'||s.n||':'||step,$1,$2,$5||':session:'||s.n,$5||':player:'||s.player,'human',
      (ARRAY['visit','loaded','first_action','round_start','pointer','pointer','pointer','round_complete','exit','pointer'])[step+1],
      s.base+(step::text||' milliseconds')::interval,'NG','desktop','fixture','fixture-campaign','',
      CASE WHEN step IN (4,5,6,9) THEN '{"x":0.2,"y":0.3}'::jsonb ELSE '{}'::jsonb END
    FROM sessions s CROSS JOIN generate_series(0,9) step`,
      [workspace, bulkGame, chunk * 1000, chunk * 1000 + 999, fixture],
    );
    assert(
      (await size()) < 100_000_000,
      "Database exceeded the acceptance size ceiling.",
    );
  }
  await query(
    `INSERT INTO events(id,workspace_id,game_id,session_id,player_id,kind,name,occurred_at,country,device,source,campaign,page,properties) VALUES ($1,$2,$3,$4,$4,'agent','visit',now(),'Synthetic','desktop','fixture','','','{}')`,
    [
      `synthetic_${fixture}`,
      workspace,
      bulkGame,
      `synthetic_session_${fixture}`,
    ],
  );
  const fixtureCount = await query<{
    human: number;
    synthetic: number;
    players: number;
  }>(
    `SELECT count(*) FILTER(WHERE kind='human')::int human,count(*) FILTER(WHERE kind='agent')::int synthetic,count(DISTINCT player_id) FILTER(WHERE kind='human')::int players FROM events WHERE workspace_id=$1 AND game_id=$2`,
    [workspace, bulkGame],
  );
  assert(
    fixtureCount[0].human === 100000 &&
      fixtureCount[0].synthetic === 1 &&
      fixtureCount[0].players === 5000,
    "Fixture data counts do not match.",
  );
  await query("ANALYZE events");
  await query("ANALYZE player_first_seen");
  audit.fixture = {
    humanEvents: 100000,
    syntheticEvents: 1,
    sessions: 10000,
    players: 5000,
    peakDatabaseBytes: await size(),
  };

  report("scoped analytics and pagination");
  const samples: number[] = [];
  let final: Awaited<ReturnType<typeof sqlAnalytics>> | undefined;
  const frozen = Date.now();
  for (let i = 0; i < 5; i++) {
    const start = performance.now();
    final = await sqlAnalytics(workspace, bulkGame, 30, frozen);
    samples.push(Math.round(performance.now() - start));
  }
  assert(
    final &&
      final.sessions === 10000 &&
      final.players === 5000 &&
      final.starts === 10000 &&
      final.completions === 10000 &&
      final.syntheticSessions === 1,
    "SQL analytics counts differ from the fixture.",
  );
  assert(
    final.sessionsList.length === 100 &&
      final.sessionPage?.total === 10000 &&
      final.sessionPage.nextCursor,
    "First analytics page is not bounded or has the wrong total.",
  );
  const next = await querySessionPage(workspace, bulkGame, 30, {
    cursor: final.sessionPage.nextCursor,
    limit: 100,
  });
  assert(
    next.sessions.length === 100 &&
      next.total === 10000 &&
      next.sessions.every(
        (s) => !final!.sessionsList.some((p) => p.id === s.id),
      ),
    "Next page is not stable or overlaps the first.",
  );
  const sorted = [...samples].sort((a, b) => a - b);
  audit.analytics = {
    runs: 5,
    elapsedMs: samples,
    p50Ms: sorted[2],
    p95Ms: sorted[Math.ceil(0.95 * sorted.length) - 1],
    percentileMethod:
      "nearest rank; five sequential samples, not a load or SLO guarantee",
    responseBytes: Buffer.byteLength(JSON.stringify(final)),
    sessions: final.sessions,
    players: final.players,
    firstPage: final.sessionsList.length,
    nextPage: next.sessions.length,
    overlap: 0,
  };

  report("query plan");
  const end = new Date(frozen).toISOString(),
    start = new Date(frozen - 30 * 86400000).toISOString();
  const queryPlan = await query<{ "QUERY PLAN": unknown }>(
    `EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) SELECT game_id,session_id,count(*) FROM events WHERE workspace_id=$1 AND game_id=$2 AND kind='human' AND occurred_at >= $3::timestamptz AND occurred_at <= $4::timestamptz GROUP BY game_id,session_id`,
    [workspace, bulkGame, start, end],
  );
  plan = JSON.parse(
    JSON.stringify(queryPlan[0]["QUERY PLAN"])
      .replaceAll(workspace, "[fixture workspace]")
      .replaceAll(bulkGame, "[fixture game]"),
  );
  const remaining = await counts();
  assert(
    remaining.events === baseline.events && remaining.games === baseline.games,
    "Non-fixture records changed during acceptance.",
  );
  audit.completed = true;
} catch (error) {
  failed = true;
  audit.error = {
    stage: audit.stage,
    code: String((error as { code?: string })?.code || ""),
    message: error instanceof Error ? redact(error.message) : "Unknown failure",
  };
  console.error(
    `Live database acceptance failed at ${audit.stage}; see the sanitized report.`,
  );
} finally {
  report("cleanup");
  if (created) {
    try {
      for (;;) {
        const removed = await query<{ id: string }>(
          `DELETE FROM events WHERE id IN (
          SELECT id FROM events WHERE workspace_id=$1 AND game_id IN ($2,$3) LIMIT 10000
        ) RETURNING id`,
          [workspace, ingestGame, bulkGame],
        );
        if (!removed.length) break;
      }
      await query(
        "DELETE FROM player_first_seen WHERE workspace_id=$1 AND game_id IN ($2,$3)",
        [workspace, ingestGame, bulkGame],
      );
      await query(
        "DELETE FROM records WHERE workspace_id=$1 AND kind='game' AND id IN ($2,$3)",
        [workspace, ingestGame, bulkGame],
      );
      const buckets = Array.from(
        {
          length:
            Math.floor(Date.now() / 60000) - Math.floor(started / 60000) + 1,
        },
        (_, i) => Math.floor(started / 60000) + i,
      );
      const rateIds = buckets.map(
        (bucket) => `events:${hash(`${ingestGame}:${fixtureIp}`)}:${bucket}`,
      );
      await query("DELETE FROM rate_windows WHERE id=ANY($1::text[])", [
        rateIds,
      ]);
      const check = await query<{
        events: number;
        firsts: number;
        records: number;
        rates: number;
      }>(
        `SELECT (SELECT count(*) FROM events WHERE workspace_id=$1)::int events,(SELECT count(*) FROM player_first_seen WHERE workspace_id=$1)::int firsts,(SELECT count(*) FROM records WHERE workspace_id=$1)::int records,(SELECT count(*) FROM rate_windows WHERE id=ANY($2::text[]))::int rates`,
        [workspace, rateIds],
      );
      assert(
        Object.values(check[0]).every((v) => v === 0),
        "Fixture cleanup did not remove all owned records.",
      );
      audit.cleanupVerified = true;
      audit.postCleanupDatabaseBytes = await size();
    } catch (error) {
      failed = true;
      audit.cleanupError =
        error instanceof Error
          ? redact(error.message)
          : "Unknown cleanup failure";
      audit.cleanupScope = { workspace, ingestGame, bulkGame };
      console.error(
        "Fixture cleanup failed; manual scoped cleanup is required.",
      );
    }
  } else audit.cleanupVerified = true;
  await direct.end().catch(() => undefined);
  await closeDatabase().catch(() => undefined);
  audit.finishedAt = new Date().toISOString();
  await mkdir(outDir, { recursive: true });
  await writeFile(
    resolve(outDir, "database-production-acceptance.json"),
    JSON.stringify(audit, null, 2) + "\n",
  );
  if (plan)
    await writeFile(
      resolve(outDir, "database-query-plan.json"),
      JSON.stringify(plan, null, 2) + "\n",
    );
  if (failed) process.exitCode = 1;
}
