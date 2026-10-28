import { beforeAll, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { applyMigrations } from "../src/lib/migrations";
import type { Game } from "../src/lib/types";

let db: typeof import("../src/lib/db");
let ingest: (typeof import("../src/lib/telemetry"))["ingest"];
const game: Game = {
  id: "batch-game",
  title: "Test",
  url: "https://game.example",
  description: "",
  image: "",
  genre: "",
  sdkKey: "batch-key-123456789012345",
  origins: ["https://game.example"],
  createdAt: "",
  dailyEnabled: false,
  competitors: [],
};
const event = (id: string, time: string, session = "session-1") => ({
  id,
  name: "visit",
  sessionId: session,
  playerId: "player-1",
  timestamp: time,
  properties: {},
  page: "https://game.example",
  referrer: "",
});
function request(events: ReturnType<typeof event>[]) {
  return new Request("https://studio.example/api/collect", {
    method: "POST",
    headers: { Origin: "https://game.example" },
    body: JSON.stringify({ sdkKey: game.sdkKey, events }),
  });
}
beforeAll(async () => {
  delete process.env.DATABASE_URL;
  delete process.env.VERCEL;
  process.env.LOCAL_DATABASE_PATH = "memory://";
  db = await import("../src/lib/db");
  ({ ingest } = await import("../src/lib/telemetry"));
  await db.put("batch-ws", "game", game);
});
it("batch inserts atomically, ignores duplicate IDs and adjusts first-seen for a newly received earlier event", async () => {
  const now = Date.now();
  const later = new Date(now - 1000).toISOString(),
    earlier = new Date(now - 3600000).toISOString();
  const first = event("event-batch-1", later, "session-later");
  const second = event("event-batch-2", later, "session-other");
  const querySpy = vi.spyOn(db, "query");
  expect(await (await ingest(request([first, second, first]))).json()).toEqual({
    accepted: 2,
  });
  expect(
    querySpy.mock.calls.filter(([sql]) => sql.includes("WITH incoming AS")),
  ).toHaveLength(1);
  querySpy.mockRestore();
  expect(
    await (await ingest(request([{ ...first, timestamp: earlier }]))).json(),
  ).toEqual({ accepted: 0 });
  let rows = await db.query<{ first_at: Date; first_session_id: string }>(
    "SELECT first_at,first_session_id FROM player_first_seen WHERE workspace_id=$1 AND game_id=$2 AND player_id=$3",
    ["batch-ws", game.id, "player-1"],
  );
  expect(new Date(rows[0].first_at).toISOString()).toBe(later);
  expect(rows[0].first_session_id).toBe("session-later");
  expect(
    await (
      await ingest(request([event("event-batch-3", earlier, "session-early")]))
    ).json(),
  ).toEqual({ accepted: 1 });
  rows = await db.query(
    "SELECT first_at,first_session_id FROM player_first_seen WHERE workspace_id=$1 AND game_id=$2 AND player_id=$3",
    ["batch-ws", game.id, "player-1"],
  );
  expect(new Date(rows[0].first_at).toISOString()).toBe(earlier);
  expect(rows[0].first_session_id).toBe("session-early");
});
it("rolls back event writes when the same statement cannot update first-seen", async () => {
  await db.query(
    "ALTER TABLE player_first_seen ADD CONSTRAINT test_block_player CHECK (player_id <> 'player-blocked')",
  );
  const bad = {
    ...event("event-blocked", new Date().toISOString()),
    playerId: "player-blocked",
  };
  await expect(ingest(request([bad]))).rejects.toThrow();
  expect(
    await db.query("SELECT id FROM events WHERE player_id=$1", [
      "player-blocked",
    ]),
  ).toHaveLength(0);
  await db.query(
    "ALTER TABLE player_first_seen DROP CONSTRAINT test_block_player",
  );
});
it("backfills legacy human data, isolates games/workspaces and rolls back failed migration", async () => {
  const local = new PGlite("memory://");
  try {
    await local.query(
      "CREATE TABLE schema_migrations(version integer PRIMARY KEY,applied_at timestamptz DEFAULT now())",
    );
    await local.query("INSERT INTO schema_migrations(version) VALUES(1)");
    await local.query(
      "CREATE TABLE events(id text PRIMARY KEY,workspace_id text,game_id text,player_id text,session_id text,kind text,occurred_at timestamptz)",
    );
    await local.query(
      "CREATE TABLE records(workspace_id text,kind text,body jsonb,updated_at timestamptz)",
    );
    for (const table of ["users", "credentials", "jobs", "daily_runs", "publish_dispatches"]) {
      await local.query(`CREATE TABLE ${table}(id text)`);
    }
    await local.query("CREATE TABLE session_capture_grants(capture_id text PRIMARY KEY,workspace_id text,game_id text,session_id text,UNIQUE(workspace_id,game_id,session_id))");
    await local.query("CREATE TABLE rate_windows(expires_at timestamptz)");
    await local.query("CREATE TABLE auth_sessions(expires_at timestamptz)");
    await local.query(`INSERT INTO events VALUES
      ('1','w1','g1','p','s-later','human','2026-01-02'),
      ('2','w1','g1','p','s-earlier','human','2026-01-01'),
      ('3','w1','g1','p','s-agent','agent','2025-01-01'),
      ('4','w2','g1','p','s-foreign','human','2026-01-03'),
      ('5','w1','g2','p','s-game','human','2026-01-04')`);
    await local.query("ALTER TABLE events ADD COLUMN name text DEFAULT 'visit'");
    await expect(
      local.transaction(async (tx) => {
        await applyMigrations(tx);
        throw new Error("force rollback");
      }),
    ).rejects.toThrow("force rollback");
    expect(
      (await local.query("SELECT version FROM schema_migrations")).rows,
    ).toEqual([{ version: 1 }]);
    await local.transaction(async (tx) => {
      await applyMigrations(tx);
    });
    const result = await local.query<{
      workspace_id: string;
      game_id: string;
      first_session_id: string;
    }>(
      "SELECT workspace_id,game_id,first_session_id FROM player_first_seen ORDER BY workspace_id,game_id",
    );
    expect(result.rows).toEqual([
      { workspace_id: "w1", game_id: "g1", first_session_id: "s-earlier" },
      { workspace_id: "w1", game_id: "g2", first_session_id: "s-game" },
      { workspace_id: "w2", game_id: "g1", first_session_id: "s-foreign" },
    ]);
    await local.transaction(async (tx) => {
      await applyMigrations(tx);
    });
    expect(
      (
        await local.query(
          "SELECT version FROM schema_migrations ORDER BY version",
        )
      ).rows,
    ).toEqual([{ version: 1 }, { version: 2 }, { version: 3 }, { version: 4 }]);
  } finally {
    await local.close();
  }
});

it("rejects streamed oversized bodies without reading subsequent chunks", async () => {
  let cancelled = false;
  let reads = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      reads++;
      controller.enqueue(new Uint8Array(40000));
    },
    cancel() {
      cancelled = true;
    },
  });
  const req = new Request("https://studio.example/api/collect", {
    method: "POST",
    body,
    duplex: "half",
  } as RequestInit);
  expect((await ingest(req)).status).toBe(413);
  expect(cancelled).toBe(true);
  expect(reads).toBeLessThanOrEqual(3);
});

it("keeps first-seen current for a legacy writer that inserts events directly", async () => {
  const now = new Date().toISOString();
  await db.query(
    `INSERT INTO events(id,workspace_id,game_id,session_id,player_id,kind,name,occurred_at,country,device,source,campaign,page,properties)
    VALUES('legacy-direct','legacy-ws','legacy-game','legacy-session','legacy-player','human','visit',$1,'','','','','','{}')`,
    [now],
  );
  await db.query(`INSERT INTO events(id,workspace_id,game_id,session_id,player_id,kind,name,occurred_at,country,device,source,campaign,page,properties)
    VALUES('legacy-direct','legacy-ws','legacy-game','earlier-session','legacy-player','human','visit','2000-01-01','','','','','','{}') ON CONFLICT(id) DO NOTHING`);
  const rows = await db.query<{ first_at: Date; first_session_id: string }>(
    "SELECT first_at,first_session_id FROM player_first_seen WHERE workspace_id='legacy-ws' AND game_id='legacy-game'",
  );
  expect(rows).toHaveLength(1);
  expect(new Date(rows[0].first_at).toISOString()).toBe(now);
  expect(rows[0].first_session_id).toBe("legacy-session");
});
