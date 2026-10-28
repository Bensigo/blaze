import { beforeAll, describe, it, expect } from "vitest";
import { summarize, type EventRow } from "../src/lib/analytics";
import type { Game } from "../src/lib/types";
const now = Date.parse("2026-10-28T12:00:00Z"),
  first = now - 3 * 86400000;
function event(
  name: string,
  session = "first-session",
  at = first,
  kind: "human" | "agent" = "human",
): EventRow {
  return {
    id: `${name}-${session}-${at}`,
    game_id: "game-test",
    session_id: session,
    player_id: "player-one",
    kind,
    name,
    occurred_at: new Date(at).toISOString(),
    country: "NG",
    device: "mobile",
    source: "x",
    campaign: "campaign",
    page: "https://play.example/game",
    properties: {},
  };
}
describe("human analytics interpretation", () => {
  it("keeps synthetic traffic out of real funnels and requires event order", () => {
    const a = summarize(
      [
        event("visit"),
        event("loaded", "first-session", first + 1),
        event("round_complete", "first-session", first + 2),
        event("first_action", "first-session", first + 3),
        event("round_start", "first-session", first + 4),
        event("visit", "agent-one", first, "agent"),
      ],
      new Map([["player-one", first]]),
      14,
      now,
    );
    expect(a.sessions).toBe(1);
    expect(a.syntheticSessions).toBe(1);
    expect(a.funnel.map((x) => x.count)).toEqual([1, 1, 1, 1, 0]);
    expect(a.completions).toBe(1);
  });
  it("does not treat a long open session as a return; counts distinct mature return visits", () => {
    const events = [
      event("visit"),
      event("round_start", "first-session", first + 25 * 3600000),
      event("visit", "second-session", first + 26 * 3600000),
    ];
    const a = summarize(events, new Map([["player-one", first]]), 14, now);
    expect(a.returns).toBe(1);
    expect(
      a.retention.find(
        (r) => r.date === new Date(first).toISOString().slice(0, 10),
      ),
    ).toMatchObject({ eligible: 1, returned: 1, rate: 1 });
    const b = summarize(
      events.slice(0, 2),
      new Map([["player-one", first]]),
      14,
      now,
    );
    expect(b.returns).toBe(0);
    expect(b.retention.find((r) => r.eligible)).toMatchObject({
      returned: 0,
      rate: 0,
    });
  });
  it("keeps new cohorts unmeasured until the full return window matures", () => {
    const at = now - 3600000;
    const a = summarize(
      [event("visit", "fresh-session", at)],
      new Map([["player-one", at]]),
      14,
      now,
    );
    expect(a.retention.at(-1)).toMatchObject({
      players: 1,
      eligible: 0,
      rate: null,
    });
  });
});
describe("persistent origin-scoped ingestion", () => {
  let db: typeof import("../src/lib/db"),
    ingest: (typeof import("../src/lib/telemetry"))["ingest"];
  const game: Game = {
    id: "game-test",
    title: "test",
    url: "https://play.example/game",
    description: "",
    image: "",
    genre: "",
    sdkKey: "sdk_123456789012345678901234567890",
    origins: ["https://play.example"],
    createdAt: new Date().toISOString(),
    dailyEnabled: false,
    competitors: [],
  };
  beforeAll(async () => {
    delete process.env.DATABASE_URL;
    delete process.env.VERCEL;
    process.env.LOCAL_DATABASE_PATH = "memory://";
    db = await import("../src/lib/db");
    ({ ingest } = await import("../src/lib/telemetry"));
    await db.put("workspace-a", "game", game);
  });
  function req(
    origin = "https://play.example",
    id = "event-123456789",
    extra: Record<string, unknown> = {},
  ) {
    return new Request("https://studio.example/api/collect", {
      method: "POST",
      headers: { Origin: origin, "Content-Type": "application/json" },
      body: JSON.stringify({
        sdkKey: game.sdkKey,
        events: [
          {
            id,
            name: "visit",
            sessionId: "session-human-1",
            playerId: "player-human-1",
            timestamp: new Date().toISOString(),
            properties: {
              message: "secret@private.example",
              step: "level_1",
              code: "bad code with input",
            },
            page: "https://play.example/game?token=secret",
            referrer: "https://x.com/post?private=secret",
            kind: "agent",
            ...extra,
          },
        ],
      }),
    });
  }
  it("rejects unapproved origins, ignores client synthetic labels, deduplicates and scrubs data", async () => {
    expect((await ingest(req("https://evil.example"))).status).toBe(403);
    expect(await (await ingest(req())).json()).toEqual({ accepted: 1 });
    expect(await (await ingest(req())).json()).toEqual({ accepted: 0 });
    const rows = await db.query<{
      kind: string;
      country: string;
      page: string;
      properties: Record<string, unknown>;
    }>("SELECT kind,country,page,properties FROM events");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      kind: "human",
      country: "Unknown",
      page: "https://play.example/game",
      properties: { step: "level_1" },
    });
    expect(rows[0].properties).not.toHaveProperty("message");
    expect(rows[0].properties).not.toHaveProperty("code");
  });
  it("accepts synthetic data only through its server-assigned identity", async () => {
    expect(
      await (
        await ingest(req("", "synthetic-event"), {
          workspace: "workspace-a",
          game,
          recordingId: "rec_server_identity",
        })
      ).json(),
    ).toEqual({ accepted: 1 });
    const r = await db.query<{
      session_id: string;
      player_id: string;
      kind: string;
    }>("SELECT session_id,player_id,kind FROM events WHERE kind='agent'");
    expect(r[0]).toEqual({
      session_id: "rec_server_identity",
      player_id: "rec_server_identity",
      kind: "agent",
    });
    expect(
      (
        await ingest(
          req("https://play.example", "bad-timestamp-event", {
            timestamp: "yesterday",
          }),
        )
      ).status,
    ).toBe(400);
    expect(
      await (
        await ingest(
          req("https://play.example", "reserved-agent-event", {
            sessionId: "rec_server_identity",
          }),
        )
      ).json(),
    ).toEqual({ accepted: 0 });
  });
  it("signals refresh only for newly accepted human events", async () => {
    const calls: string[] = [];
    const callback = async (workspace: string, gameId: string) => { calls.push(`${workspace}:${gameId}`); };
    await ingest(req("https://play.example", "refresh-human-event"), undefined, callback);
    await ingest(req("https://play.example", "refresh-human-event"), undefined, callback);
    await ingest(req("", "refresh-agent-event"), { workspace: "workspace-a", game, recordingId: "rec_refresh" }, callback);
    expect(calls).toEqual(["workspace-a:game-test"]);
    const result = await ingest(req("https://play.example", "refresh-failure-event"), undefined, async () => { throw new Error("private details"); });
    expect(result.status).toBe(200); expect(await result.json()).toEqual({ accepted: 1 });
  });
});
