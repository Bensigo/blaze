# Blaze

Open-source analytics, SEO and AEO for web games. MIT licensed.

Blaze helps developers understand visits, meaningful play, completion, return cohorts, errors, sources and player friction. Its browser SDK collects bounded, consented events. SEO/AEO reports pair public-page checks with authorized search observations and explicitly labeled citation evidence. External agents can read reports through MCP; Blaze requires no AI model or inference key.

## Run locally

Use Node 22+.

```sh
npm ci
cp .env.example .env.local
npm run dev
```

Open http://127.0.0.1:3000. Local development sign-in works only in development/test. PGlite stores local data in `.data/postgres`; no hosted database is needed locally. Run `npm run db:migrate` explicitly when using PostgreSQL. Keep `.env.local` and `.data` private.

## Connect a game

1. Add a public game URL in the workspace. Blaze imports available HTML metadata. An [optional version-1 game manifest](docs/GAME-MANIFEST.md) at `<game-url>/forever.json` can supply richer validated details; no Forever account or integration is required. Review the metadata and permitted event origins.
2. Follow the [SDK quickstart](public/docs/sdk/quickstart.md), [SDK reference](public/docs/sdk/v1.md) and optional [frame contract](docs/FRAME-CONTRACT.md). Obtain the appropriate player consent before enabling collection.
3. Verify actual events before interpreting analytics. Empty reports mean absent evidence, not proof that a game has no players.
4. Refresh SEO/AEO under the game's Search & answers view. Connect an authorized Search Console property for real search observations. See [SEO/AEO evidence and limitations](docs/SEO-AEO.md).
5. Create a revocable read-only token in Account to [connect an external MCP agent](docs/MCP.md).

## What is measured

- Ordered visit/load/start/action/completion funnels, trends, completion and active-play coverage.
- Approximate country/device, observed referrers and explicit campaign tags; these have attribution gaps.
- Session event timelines, bounded pointer heatmaps, progression and errors.
- Returning browser identifiers and mature D1 cohorts. Identifiers are browser/device pseudonyms, not verified people or cross-device accounts.
- Optional, separately consented private canvas recordings. Off by default; no DOM or audio capture. Existing masks, sampling, duration and retention limits apply.
- Safe, dated public-page SEO/AEO audits; authorized Search Console Web observations; separately labeled owner-reported Bing AI Performance citation counts. This is not automated universal citation tracking.

Static HTML presence checks do not prove indexing, answer correctness or visibility in an AI answer. Search Console Web data combines Search surfaces. Owner-reported citation counts are unverified by Blaze. Before/after comparisons are observational and do not prove a change caused an improvement.

## Hosting

Next.js serves the workspace and API. Production requires PostgreSQL and managed Google authentication through Neon Managed Better Auth. Set the fields documented in `.env.example`, configure your own Google OAuth client in Neon, trust only your real application origins and run migrations before serving traffic. Server credentials must never enter the browser SDK or a game.

Private player capture optionally uses the configured S3-compatible Neon store or a private Vercel Blob store. Never make player media public. The Netlify scheduled function performs retention cleanup at 06:00 UTC; on another host invoke the authenticated `/api/cron/daily` endpoint with `CRON_SECRET` daily. Requests also deny expired capture playback. Monitor cleanup failures. SEO/AEO checks run on owner request; there is no daily research or content-production worker.

The current runtime target is under 100,000 events/day. This is a design target, not a tested sustained-capacity guarantee. Dashboard queries aggregate in SQL; ingestion is bounded and deduplicated. Raw analytics event retention is disabled by default. Set `EVENT_RETENTION_DAYS` to an integer from 7 to 3650 to enable scheduled deletion of events older than that many days by their event timestamp. Each run deletes up to 10,000 oldest eligible events; reaching that limit reports an incomplete/failed run, and later runs drain the backlog. First-seen records are retained, but historical event-based reports become incomplete. Choose a retention window at least as long as the reports you need; no production deletion runs as part of setup. Account settings show the last observed cleanup outcome and whether event retention is configured; an unobserved run is not proof the scheduler works. See [database migrations](docs/DB-MIGRATIONS.md).

## Site health and audience

[Site health](docs/SITE-HEALTH.md) connects your platform’s own server-side diagnostics report using a scoped HTTPS bearer connection. There is no default platform endpoint. The optional legacy Forever connector remains compatible with installed integrations.

Analytics is split into Engagement, Acquisition, Retention and Audience. The Audience globe displays observed country aggregates at country reference points, with an accessible table and unknown-location coverage. It does not collect or display exact visitor coordinates. Country selection highlights that breakdown only. Aggregate CSV downloads preserve the selected game and date window, exclude raw player/session identifiers and neutralize spreadsheet formulas.

Blaze source is MIT licensed; attributed country reference data is separately ODbL-1.0 (see NOTICE and src/data/COUNTRY-DATA-LICENSE).

## Development

```sh
npm test
npm run typecheck
npm run build
```

GitHub CI verifies a clean Node 22 install, tests, build and typecheck for changes.

Tests use controlled fixtures and cover analytics semantics, SDK safety, workspace isolation, capture and discovery/MCP boundaries. They do not establish human enjoyment, physical-device audio behavior or live provider acceptance.

See [contributing](CONTRIBUTING.md), [security](SECURITY.md), [product scope](docs/PRD.md), and [architecture](docs/CONTEXT.md). Automated gameplay, AI generation, Content Studio, social publication and calendar planning are removed. Legacy database rows remain stored for owner recovery; this cleanup does not delete production data.
