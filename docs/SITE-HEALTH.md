# Site health integration

Site health connects one Blaze workspace to a platform-operated diagnostics endpoint. Set `SITE_HEALTH_URL` to the full HTTPS report URL, `SITE_HEALTH_TOKEN` to a high-entropy bearer token of at least 32 characters, and `SITE_HEALTH_WORKSPACE_ID` to the internal Blaze workspace ID. Restart the server after configuration. The endpoint must be accessible on public IPv4 over standard HTTPS, with a valid certificate. Private and mixed DNS addresses, credentials in URLs, query strings, redirects and nonstandard ports are rejected. The token stays server-side. The generic endpoint has no default platform URL. Missing configuration or another workspace returns “not configured”; failure is “unavailable”, never zero traffic.

The endpoint must authorize the bearer token and return a fresh JSON report matching version 1, with `generatedAt` no older than 15 minutes. Responses are capped at 256 KiB and unknown fields are stripped. See `src/lib/site-report.ts` (shared with the legacy adapter) for the authoritative validation schema. The required shape is:

```json
{
  "schemaVersion": 1,
  "generatedAt": "2026-01-15T00:00:00.000Z",
  "window": {"days": 14, "since": "2026-01-01T00:00:00.000Z", "until": "2026-01-15T00:00:00.000Z"},
  "summary": {"sessions": 0, "gameViewSessions": 0, "playClickSessions": 0, "readySessions": 0, "startedSessions": 0, "actionSessions": 0, "noPlaySessions": 0, "errorSessions": 0},
  "funnel": [], "games": [], "errors": [],
  "delivery": {"pending": 0, "dropped": 0, "writeFailures": 0},
  "recent": [], "limitations": []
}
```

Counts must describe the selected 14-day window. Populate arrays and optional catalogue/journey fields only from your platform's actual instrumentation; consult the schema for their bounded fields and accepted values. Use pseudonymous, non-identifying labels and include collection gaps in `limitations`. The platform collector must separately instrument site visits, game views, play clicks and game lifecycle events to calculate site-wide no-play counts; installing the browser game SDK alone does not provide those counts. An empty array means no rows supplied, not proof that every category was observed.

`/api/site/observability` reads this generic connection. `/api/forever/observability` remains a legacy compatibility route; where generic configuration is absent it retains the previous Forever-specific environment and endpoint behavior. Legacy Forever settings do not configure the generic route.

Each `funnel` entry is `{ "stage": "visit", "sessions": 12 }`. Each `games` entry contains `game`, `views`, `playClicks`, `ready`, `starts`, `actions` (number or null), `actionCoverage` (`live`, `finish_only`, or `unmeasured`), `completed`, and `errorSessions`. Each `errors` entry contains `code`, `game`, `browser`, `device`, `count`, `sessions`, ISO `lastAt`, and `source` (`browser` or `server`). Each `recent` entry contains a pseudonymous `session`, `game`, `device`, `browser`, ISO `at`, `stage`, and optional `code`. Labels accept only letters, numbers, underscore, period, colon and hyphen, up to 100 characters; counts are nonnegative safe integers. Arrays are capped at 10 funnel rows, 100 game/error/recent rows, and 20 limitation strings of at most 1,000 characters. Optional `completedSessions` in summary is a count. Optional `release` is a 40-character lowercase hexadecimal commit ID; omit it for other release formats.
