import type { TelemetryEvent, WorkspaceSnapshot } from "./types";
import { summarize, type EventRow } from "./analytics";

/** Illustrative, deterministic fixture data. No events here come from a real game or player. */
function demoData(gameId?: string, days = 30) {
  const now = Date.now();
  const anchor = Math.floor(now / 86400000) * 86400000;
  const duration = [7, 14, 30].includes(days) ? days : 30;
  const fixtureId = "example-star-catch";
  const iso = (daysAgo: number, minute = 0) =>
    new Date(anchor - daysAgo * 86400000 + minute * 60000).toISOString();
  const events: EventRow[] = [];
  const firstSeen = new Map<string, number>();
  if (!gameId || gameId === fixtureId) {
    for (let day = 0; day < duration; day++) {
      const count = 3 + ((day * 7 + 2) % 6);
      for (let n = 0; n < count; n++) {
        const player = n < 2 ? `example-return-${Math.floor(day / 2)}-${n}` : `example-player-${day}-${n}`;
        const session = `example-session-${day}-${n}`;
        const at = iso(day, -n * 10);
        firstSeen.set(player, Math.min(firstSeen.get(player) ?? Infinity, new Date(at).getTime()));
        const names =
          n % 5 === 0
            ? ["visit", "loaded"]
            : n % 4 === 0
              ? ["visit", "loaded", "first_action", "round_start", "active_play"]
              : [
                  "visit",
                  "loaded",
                  "first_action",
                  "round_start",
                  "active_play",
                  "player_action",
                  "milestone",
                  "round_complete",
                ];
        if ((day + n) % 3 === 0) names.push("exit");
        names.forEach((name, i) =>
          events.push({
            id: `${session}-${i}`,
            game_id: fixtureId,
            session_id: session,
            player_id: player,
            kind: "human",
            name,
            occurred_at: new Date(
              new Date(at).getTime() + i * 12000,
            ).toISOString(),
            country: ["NG", "GB", "US", "AE", "JP"][(day+n)%5],
            device: n % 3 === 0 ? "mobile" : "desktop",
            source: n % 3 === 0 ? "social" : n % 3 === 1 ? "search" : "direct",
            campaign: n % 3 === 0 ? "launch-week" : n % 3 === 1 ? "game-discovery" : "",
            page: "/fixture/index.html",
            properties: name === "active_play" ? { duration: 7 + n } :
              name === "player_action" ? { key: "catch_star" } :
              name === "milestone" ? { key: "first_round", value: 1 } : {},
          }),
        );
      }
    }
  }
  return { now, duration, fixtureId, iso, events, firstSeen };
}

export function demoSessionEvents(sessionId: string, gameId?: string, days = 30): TelemetryEvent[] {
  return demoData(gameId, days).events.filter(event => event.session_id === sessionId).map(event => ({
    id: event.id, name: event.name, gameId: event.game_id, sessionId: event.session_id,
    playerId: event.player_id, timestamp: new Date(event.occurred_at).toISOString(), properties: event.properties,
    page: event.page, referrer: "", campaign: event.campaign, source: event.source,
    device: event.device, kind: event.kind,
  }));
}

export function buildDemo(gameId?: string, days = 30): WorkspaceSnapshot {
  const { now, duration, fixtureId, iso, events, firstSeen } = demoData(gameId, days);
  const analytics = summarize(events, firstSeen, duration, now);
  // This sample describes an unsupported attempt; it does not imply footage exists.
  if (analytics.sessionsList[0]) analytics.sessionsList[0].captureStatus = "unsupported";
  return {
    user: null,
    workspace: { id: "example", name: "Example workspace" },
    demo: true,
    games: [
      {
        id: fixtureId,
        title: "Star Catch · example",
        url: "/fixture/index.html",
        description:
          "Controlled fixture game. The activity shown here is illustrative.",
        image: "/fixture/cover.svg",
        genre: "Fixture",
        sdkKey: "EXAMPLE_ONLY",
        origins: [],
        createdAt: iso(30),
        dailyEnabled: false,
        competitors: [],
        metadataStatus: "illustrative",
      },
    ],
    recordings: [],
    clips: [],
    posts: [],
    connections: [],
    findings: [
      {
        id: "example-finding",
        gameId: fixtureId,
        title: "Example: compare the first action with round starts",
        detail:
          "Illustrative hypothesis for learning the workflow; validate it against real player evidence.",
        type: "hypothesis",
        priority: "medium",
        evidence: [{ label: "Illustrative session data" }],
        status: "open",
        createdAt: iso(1),
      },
    ].filter(
      (x) => !gameId || x.gameId === gameId,
    ) as WorkspaceSnapshot["findings"],
    runs: [],
    measurements:
      !gameId || gameId === fixtureId
        ? [
            {
              id: "example-measurement",
              gameId: fixtureId,
              findingId: "example-finding",
              note: "Example change: simplified first-round instructions",
              startedAt: iso(7),
              baseline: {
                sessions: 72,
                starts: 52,
                completions: 40,
                errorSessions: 2,
              },
              after: {
                sessions: 38,
                starts: 27,
                completions: 22,
                errorSessions: 1,
              },
              daysObserved: 7,
            },
          ]
        : [],
    analytics,
    system: {
      database: false,
      google: false,
      storage: false,
      worker: false,
      dailySchedule: "Not configured in example",
      publishingEnabled: false,
    },
  };
}
