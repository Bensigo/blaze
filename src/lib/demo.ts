import type { WorkspaceSnapshot } from "./types";
import { summarize, type EventRow } from "./analytics";

/** Illustrative, deterministic fixture data. No events here come from a real game or player. */
export function buildDemo(gameId?: string, days = 30): WorkspaceSnapshot {
  const now = Date.now();
  const duration = [7, 14, 30].includes(days) ? days : 30;
  const fixtureId = "example-star-catch";
  const iso = (daysAgo: number, minute = 0) =>
    new Date(now - daysAgo * 86400000 + minute * 60000).toISOString();
  const events: EventRow[] = [];
  const firstSeen = new Map<string, number>();
  if (!gameId || gameId === fixtureId) {
    for (let day = 0; day < duration; day++) {
      const count = 3 + ((day * 7 + 2) % 6);
      for (let n = 0; n < count; n++) {
        const player = `example-player-${day}-${n}`;
        const session = `example-session-${day}-${n}`;
        const at = iso(day, -n * 10);
        firstSeen.set(player, new Date(at).getTime());
        const names =
          n % 5 === 0
            ? ["visit", "loaded"]
            : n % 4 === 0
              ? ["visit", "loaded", "first_action", "round_start"]
              : [
                  "visit",
                  "loaded",
                  "first_action",
                  "round_start",
                  "round_complete",
                ];
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
            country: "Unknown",
            device: n % 3 === 0 ? "mobile" : "desktop",
            source: n % 3 === 0 ? "social" : "direct",
            campaign: "",
            page: "/fixture/index.html",
            properties: {},
          }),
        );
      }
    }
  }
  const analytics = summarize(events, firstSeen, duration, now);
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
    recordings: [
      {
        id: "example-recording",
        gameId: fixtureId,
        title: "Example recording · illustration only",
        status: "failed",
        mode: "fixture",
        createdAt: iso(2),
        screenshotUrl: "/fixture/cover.svg",
        error:
          "This is an illustration. Queue a real fixture run in your own workspace to produce footage.",
        observations: [
          {
            at: 4,
            text: "Example observation: the player moves toward the falling star.",
            type: "observation",
          },
        ],
      },
    ].filter(
      (x) => !gameId || x.gameId === gameId,
    ) as WorkspaceSnapshot["recordings"],
    clips: [],
    posts: [
      {
        id: "example-post",
        gameId: fixtureId,
        channel: "x",
        text: "Example draft: Try catching three stars in Star Catch.",
        accountId: "example-account",
        status: "review",
        createdAt: iso(1),
        scheduledAt: iso(-2),
        campaignId: "example-campaign",
      },
    ].filter(
      (x) => !gameId || x.gameId === gameId,
    ) as WorkspaceSnapshot["posts"],
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
      google: !!(
        process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
      ),
      storage: false,
      worker: false,
      dailySchedule: "Not configured in example",
      publishingEnabled: false,
    },
  };
}
