// Versioned schema changes are run in a single transaction by the database adapter.
type Executor = {
  query(sql: string, params?: unknown[]): Promise<{ rows: unknown[] }>;
};
export const SCHEMA_VERSION = 4;
const initialSchema = [
  `CREATE TABLE IF NOT EXISTS users (id text PRIMARY KEY, email text NOT NULL, name text NOT NULL, workspace_id text NOT NULL UNIQUE, created_at timestamptz NOT NULL DEFAULT now())`,
  `CREATE TABLE IF NOT EXISTS auth_sessions (token_hash text PRIMARY KEY, user_id text NOT NULL REFERENCES users(id), expires_at timestamptz NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS records (workspace_id text NOT NULL, kind text NOT NULL, id text NOT NULL, body jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(workspace_id,kind,id))`,
  `CREATE INDEX IF NOT EXISTS records_kind_idx ON records(kind,updated_at)`,
  `CREATE TABLE IF NOT EXISTS credentials (workspace_id text NOT NULL, provider text NOT NULL, encrypted text NOT NULL, PRIMARY KEY(workspace_id,provider))`,
  `CREATE TABLE IF NOT EXISTS events (id text PRIMARY KEY,workspace_id text NOT NULL,game_id text NOT NULL,session_id text NOT NULL,player_id text NOT NULL,kind text NOT NULL CHECK(kind IN ('human','agent')),name text NOT NULL,occurred_at timestamptz NOT NULL,received_at timestamptz NOT NULL DEFAULT now(),country text NOT NULL,device text NOT NULL,source text NOT NULL,campaign text NOT NULL,page text NOT NULL,properties jsonb NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS events_scope_idx ON events(workspace_id,game_id,kind,occurred_at)`,
  `CREATE INDEX IF NOT EXISTS events_session_idx ON events(workspace_id,session_id,occurred_at)`,
  `CREATE TABLE IF NOT EXISTS jobs (id text PRIMARY KEY, workspace_id text NOT NULL,kind text NOT NULL,state text NOT NULL,body jsonb NOT NULL,available_at timestamptz NOT NULL DEFAULT now(),lease_until timestamptz,updated_at timestamptz NOT NULL DEFAULT now())`,
  `CREATE INDEX IF NOT EXISTS jobs_queue_idx ON jobs(kind,state,available_at)`,
  `CREATE TABLE IF NOT EXISTS rate_windows (id text PRIMARY KEY,count integer NOT NULL,expires_at timestamptz NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS daily_runs (workspace_id text NOT NULL,game_id text NOT NULL,day text NOT NULL,run_id text NOT NULL,lease_until timestamptz NOT NULL,PRIMARY KEY(workspace_id,game_id,day))`,
  `CREATE TABLE IF NOT EXISTS publish_dispatches (workspace_id text NOT NULL,post_id text NOT NULL,approval_hash text NOT NULL,state text NOT NULL,updated_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(workspace_id,post_id,approval_hash))`,
  `CREATE TABLE IF NOT EXISTS session_capture_grants (capture_id text PRIMARY KEY, workspace_id text NOT NULL, game_id text NOT NULL, session_id text NOT NULL, origin text NOT NULL, token_hash text NOT NULL, expires_at timestamptz NOT NULL, state text NOT NULL, UNIQUE(workspace_id,game_id,session_id))`,
];
const telemetrySchema = [
  `CREATE TABLE IF NOT EXISTS player_first_seen (workspace_id text NOT NULL, game_id text NOT NULL, player_id text NOT NULL, first_at timestamptz NOT NULL, first_session_id text NOT NULL, PRIMARY KEY(workspace_id,game_id,player_id))`,
  `CREATE INDEX IF NOT EXISTS player_first_seen_scope_time_idx ON player_first_seen(workspace_id,game_id,first_at)`,
  `CREATE INDEX IF NOT EXISTS events_human_visit_player_time_idx ON events(workspace_id,game_id,player_id,occurred_at,session_id) WHERE kind='human' AND name='visit'`,
  `CREATE INDEX IF NOT EXISTS events_workspace_time_idx ON events(workspace_id,occurred_at)`,
  `CREATE INDEX IF NOT EXISTS events_game_time_idx ON events(workspace_id,game_id,occurred_at)`,
  `CREATE INDEX IF NOT EXISTS records_capture_lookup_idx ON records (workspace_id, (body->>'gameId'), (body->>'sessionId'), updated_at DESC) WHERE kind='session_capture'`,
  `CREATE INDEX IF NOT EXISTS records_game_sdk_key_idx ON records ((body->>'sdkKey')) WHERE kind='game'`,
  `CREATE INDEX IF NOT EXISTS rate_windows_expiry_idx ON rate_windows(expires_at)`,
  `CREATE INDEX IF NOT EXISTS auth_sessions_expiry_idx ON auth_sessions(expires_at)`,
  `CREATE OR REPLACE FUNCTION studio_update_player_first_seen() RETURNS trigger
   LANGUAGE plpgsql AS $$
   BEGIN
     INSERT INTO player_first_seen(workspace_id,game_id,player_id,first_at,first_session_id)
     SELECT DISTINCT ON (workspace_id,game_id,player_id) workspace_id,game_id,player_id,occurred_at,session_id
     FROM inserted_events WHERE kind='human'
     ORDER BY workspace_id,game_id,player_id,occurred_at,session_id
     ON CONFLICT (workspace_id,game_id,player_id) DO UPDATE SET first_at=excluded.first_at,first_session_id=excluded.first_session_id
     WHERE (excluded.first_at,excluded.first_session_id)<(player_first_seen.first_at,player_first_seen.first_session_id);
     RETURN NULL;
   END $$`,
  `CREATE TRIGGER studio_events_first_seen AFTER INSERT ON events
   REFERENCING NEW TABLE AS inserted_events FOR EACH STATEMENT EXECUTE FUNCTION studio_update_player_first_seen()`,
  `INSERT INTO player_first_seen(workspace_id,game_id,player_id,first_at,first_session_id)
    SELECT DISTINCT ON (workspace_id,game_id,player_id) workspace_id,game_id,player_id,occurred_at,session_id
    FROM events WHERE kind='human' ORDER BY workspace_id,game_id,player_id,occurred_at,session_id
    ON CONFLICT (workspace_id,game_id,player_id) DO UPDATE SET first_at=excluded.first_at, first_session_id=excluded.first_session_id
    WHERE (excluded.first_at,excluded.first_session_id)<(player_first_seen.first_at,player_first_seen.first_session_id)`,
];
// Application tables are server-only. Scope changes to this explicit list;
// Supabase's auth, storage, and other project objects are not application-owned.
export const APPLICATION_TABLES = [
  "users", "auth_sessions", "records", "credentials", "events", "jobs",
  "rate_windows", "daily_runs", "publish_dispatches", "session_capture_grants",
  "player_first_seen", "schema_migrations",
] as const;
const serverOnlySchema = [
  ...APPLICATION_TABLES.map((table) => `ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY`),
  ...APPLICATION_TABLES.map((table) => `REVOKE ALL PRIVILEGES ON TABLE public.${table} FROM PUBLIC`),
  `DO $$ DECLARE role_name text; table_name text; BEGIN
    FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated'] LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
        FOREACH table_name IN ARRAY ARRAY[${APPLICATION_TABLES.map((table) => `'${table}'`).join(",")}] LOOP
          EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.%I FROM %I', table_name, role_name);
        END LOOP;
      END IF;
    END LOOP;
  END $$`,
  // Pre-existing policies would defeat the intended no-policy server-only model.
  // Refuse to silently accept them; inspection and resolution are required.
  `DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename = ANY(ARRAY[${APPLICATION_TABLES.map((table) => `'${table}'`).join(",")}])) THEN
      RAISE EXCEPTION 'Application tables have existing row security policies; review before migration';
    END IF;
  END $$`,
];
const segmentedCaptureSchema = [
  `ALTER TABLE session_capture_grants ADD COLUMN IF NOT EXISTS segment_index integer NOT NULL DEFAULT 0 CHECK(segment_index>=0 AND segment_index<4)`,
  `ALTER TABLE session_capture_grants DROP CONSTRAINT IF EXISTS session_capture_grants_workspace_id_game_id_session_id_key`,
  `CREATE UNIQUE INDEX IF NOT EXISTS session_capture_segment_idx ON session_capture_grants(workspace_id,game_id,session_id,segment_index)`,
];
export async function applyMigrations(tx: Executor) {
  await tx.query(
    `CREATE TABLE IF NOT EXISTS schema_migrations (version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`,
  );
  const rows = (
    await tx.query(`SELECT version FROM schema_migrations ORDER BY version`)
  ).rows as { version: number }[];
  if (rows.some((row) => row.version > SCHEMA_VERSION))
    throw new Error("Database schema is newer than this application.");
  for (const [index, statements] of [
    initialSchema,
    telemetrySchema,
    serverOnlySchema,
    segmentedCaptureSchema,
  ].entries()) {
    const version = index + 1;
    if (rows.some((row) => row.version === version)) continue;
    for (const statement of statements) await tx.query(statement);
    await tx.query("INSERT INTO schema_migrations(version) VALUES($1)", [
      version,
    ]);
  }
}
export async function validateSchema(db: Executor) {
  let rows: { version: number }[];
  try {
    rows = (
      await db.query("SELECT version FROM schema_migrations ORDER BY version")
    ).rows as { version: number }[];
  } catch {
    throw new Error(
      "Database schema is unavailable or not migrated. Run npm run db:migrate.",
    );
  }
  if (
    rows.length !== SCHEMA_VERSION ||
    rows.some((row, index) => row.version !== index + 1)
  )
    throw new Error(
      "Database schema version does not match this application. Run npm run db:migrate.",
    );
}
