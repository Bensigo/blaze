# Forever internal diagnostics

Requested 4 November 2026: make Blaze useful to us first, so we can see website visits that never reach a game and the issues players encounter. This is an operator view of Forever's first-party report. It does not depend on registering each game, a paid error service, AI keys, a recording worker, or the optional Blaze browser SDK.

## Connection

Forever serves a read-only `GET /api/internal/site-diagnostics` report when `FORVER_OBSERVABILITY_TOKEN` contains a random bearer of at least 32 characters. Use a dedicated token, not an account password, SDK key, provider key or database credential.

On Blaze, set `FOREVER_OBSERVABILITY_TOKEN` to that same bearer and `FOREVER_OBSERVABILITY_WORKSPACE_ID` to the exact authenticated operator workspace ID. Workspace IDs are available in the owner's authenticated `/api/workspace` response. Never prefix these variables with `NEXT_PUBLIC_`. The browser receives the sanitized report through authenticated `GET /api/forever/observability`, never the bearer. Other workspaces cannot read it. Production reads only `https://playforever.app/api/internal/site-diagnostics`, with redirects forbidden and bounded response size/deadline. A loopback-only `FOREVER_OBSERVABILITY_LOCAL_ORIGIN` is supported during local development.

Open **Forever health** in Blaze. This view always covers the last 14 days and ignores the per-game SDK filters. A missing, unreachable, stale or rejected connection is shown as unavailable; it is never replaced by zero visitors or example data. Reports are read live and not stored in Blaze.

## Reading the evidence

- Website visits are in-memory document sessions, not unique people. Refreshing a page starts another session. No persistent visitor identifier is created for these diagnostics.
- “Never started a round” is a visit without an observed round start. It includes open tabs, blocked/dropped telemetry and incomplete instrumentation; it does not establish why a visitor left.
- The ordered funnel follows one game's stages after the visit. Per-game rows show event presence separately. A Play click or ready renderer never counts as gameplay.
- Round/action signals follow the existing gameplay lifecycle, with separate local-game hooks. These browser observations do not replace Forever's canonical server result journals or existing server-verified launch diagnostics.
- First-action coverage is explicit: Dog Chase and Tuk Tuk Rush are unmeasured, Rage Football reports actions at finish, and other supported games use their accepted lifecycle signals. The strict funnel stops at first action; completions are shown separately per game.
- Issues are fixed codes grouped by game, browser and device, with generic server 5xx counts separate from browser sessions. No raw exception messages, stack traces, request bodies, private URLs, account identifiers, or recordings are returned.
- Recent evidence is a bounded sample. Delivery loss, instrumentation gaps, retention and automation filtering limits remain visible in the report.

## Release checks

Ship Forever's additive database migration and diagnostics endpoint, then configure the private connection and ship Blaze. Verify both unauthenticated denial and another-workspace denial. In a disposable local database, exercise a visit-only session, a Play click without a round, a real started round/action and a classified failure. Read those counts through the real bridge. Check desktop, tablet, phone and landscape layouts. Browser emulation does not prove real-phone game performance or human enjoyment.

No live visitor diagnosis can be made from data that predates this instrumentation. Release status and acceptance evidence belong in the release receipt, not inferred from these source files.
