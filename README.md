# Blaze

Independent web-game marketing and player-evidence product. This repository does not change Forever.

## Run locally

Node 22+, then `npm ci`, copy `.env.example` to `.env.local`, set a random `WORKER_TOKEN`, and run `npm run dev`. Open `http://127.0.0.1:3000`. The local development sign-in is unavailable in production. PGlite persists local PostgreSQL data in `.data/postgres`; PostgreSQL is used when `DATABASE_URL` is set.

The development script uses Next.js webpack mode. The local Turbopack server repeatedly reloaded during the latest browser checks; webpack allowed those checks to proceed. This choice does not change the production build command.

The public landing page is `/`; the authenticated workspace is `/app`. An illustrative, read-only example opens only when the visitor explicitly chooses it and never enters real analytics.

## First real workflow

1. Enable Managed Better Auth on the existing Neon database branch. Set server-only `NEON_AUTH_BASE_URL`, a random `NEON_AUTH_COOKIE_SECRET` of at least 32 characters, pooled `DATABASE_URL`, and canonical `APP_URL`. Run `npm run db:migrate` before deployment. Register `<NEON_AUTH_BASE_URL>/callback/google` in the owner's Google OAuth web client, add the app origin to Neon's trusted domains, and configure the Google client ID and secret in Neon. Set `NEON_AUTH_GOOGLE_CONFIGURED=true` only after the owner's client is configured; shared development credentials are not for production. Verified Neon users receive server-owned isolated workspaces.
2. Add a public web-game URL. Its actual metadata supplies title, description and art; edit metadata, origins and artwork as needed. Saving queues an investigation; its profile separates source-backed facts, owner edits and missing evidence. A URL alone does not prove playable controls or reveal private player data.
3. Install [the SDK](docs/SDK.md), connect it to the game's meaningful actions and obtain the player's appropriate consent. Check events in Sessions and human analytics. Country comes from approximate hosting geography, while source and campaign use referral/campaign data.
4. Configure Jev, Anthropic and required research/account connections. Tokens are encrypted server-side. Native OAuth onboarding and provider-specific refresh/disconnect flows are implemented for X, YouTube, Instagram and TikTok, with explicit manual-token fallback. Provider app registration, scopes, audits and real-account acceptance remain necessary.
5. Run [the recording worker](docs/WORKER.md) on a trusted host. It polls the API, uses a structured game adapter and records actual browser video. Configure exact public HTTPS resource and WSS origins per game. Other destinations remain denied. Arbitrary games require the isolated browser and egress guard; container firewall acceptance remains pending. A controlled fixture is included at `/fixture/index.html`. Fixture decisions are explicitly labeled and do not validate Jev.
6. Create landscape, square or portrait clips. Portrait/square use padding, preserving the full gameplay image. An actual successful Jev run can queue a bounded clip candidate and, with a configured Anthropic model, a reviewable draft. Automated recording defaults to 24 hours only after documented game, key, worker and investigation readiness; it can be paused. The historical readiness check is not proof that a provider is currently available. Clips have no audio track; actual phone audio and enjoyment remain untested.
7. Review the exact text, clip, destination, delivery method and time. Approval binds those fields and editing clears it. Native delivery requires a verified provider account and any required TikTok choices. Manual delivery uses a user-entered unverified handle: after approval, prepare the caption and download the private clip. Export is not publication; a later URL and time are recorded as user-confirmed, not provider-verified.

## Runtime boundaries

- Vercel hosts the landing page, workspace and API. Neon PostgreSQL and Managed Better Auth are the selected target; private recordings use the existing private Blob store. See the latest release handover for actual provisioning and acceptance status.
- The repository configures Vercel Cron for 06:00 UTC. The source durably queues daily research and performs bounded recovery; the worker drains additional jobs. Run history distinguishes missing sources, failure and partial coverage. SEO baselines use weekly changes; Search Console compares finalized 28-day windows. Deployment and runtime acceptance must be checked for the actual release.
- The worker is required for gameplay recording, clip encoding, extra research queue work and minute-level scheduled publication checks. When it is offline, those jobs wait; the daily cron still handles its bounded research work and due publication checks. Vercel is not an always-running browser worker.
- Worker uploads can go directly to private Blob to avoid Vercel's request body limit. Private media routes enforce account access and byte ranges; publishing gets a short-lived signed transfer URL only where needed.
- Google sign-in, Jev decisions, Anthropic prose, authorized research and each publishing destination need their own genuine credentials/scopes. No social post is published during tests. TikTok public posting also needs an audited compliant app. No publishing vendor was selected.

## Telemetry storage

The application inserts validated event batches atomically and maintains game-scoped first-seen state in a PostgreSQL statement trigger, including legacy writers and late arrivals. Dashboard metrics aggregate in SQL; session pages have bounded, scope-bound cursors and explicit coverage limits. No 90-day raw-event payload is loaded into Node for dashboard aggregation. Migrations are versioned, locked and explicit; requests validate the schema and apply a transaction-local 15-second query timeout. App tables have RLS and revoked anonymous/authenticated Data API privileges; access goes through the authenticated server. Migration 4 was applied to the existing Neon database; source and deployment still require alignment and acceptance.

The declared launch target is under 100,000 events/day. A controlled 100,000-event test on the existing Neon instance verified the query path, batching, cancellation and cleanup; five sequential full analytics calls had a 1.54-second median. This is not a sustained-throughput or capacity guarantee. With `DATABASE_STORAGE_LIMIT_BYTES` configured, the source pauses both human and synthetic event ingestion at 80% of a cached current-database estimate or when it cannot be read. That estimate is not Neon project/branch storage accounting and can lag by 30 seconds; other writes can still fail at the actual quota. Raw event deletion/archival is not enabled; define retention separately.

## Analytics interpretation

The research agent uses Vercel AI SDK's bounded `ToolLoopAgent`, and content generation uses its Anthropic provider with the workspace owner's configured model and key. Both reload scoped game history: up to 90 days of human activity and campaign traffic, previous post copy and status, recommendations, and measured changes. History informs drafts and reviewable suggestions; missing data, small samples and unavailable social impressions stay explicit. Jev retains its separate TypeSafe typed-action adapter for gameplay. No model call can approve or publish a post.

Human reports exclude server-issued agent sessions. Event ingestion validates game origin and schema and deduplicates IDs, but public browser telemetry is not a verified human identity or fraud detector. The funnel requires visit, load and round start in that order; first action can occur before or after round start, and completion must follow both. Completion totals can differ from the funnel when earlier instrumentation is absent.

Returning players need a distinct later session at least 24 hours after first observation. D1 retention uses a distinct visit in the 24–48 hour window, and only cohorts at least 48 hours old enter the denominator. Player IDs are anonymous browser/device identifiers, not cross-device accounts. Ad blockers, consent refusal, cleared storage, absent SDK events and platform referrer policies create coverage gaps.

Pointer density is a normalized 2D interaction view, not a semantic canvas replay; game-frame and viewport surfaces are distinguished. Human sessions have event timelines and optional private canvas recordings. Recording requires owner configuration and surface review, analytics consent, and separate affirmative player recording consent; it stays off by default. Capture excludes DOM and audio, applies configured masks, and can record up to four bounded 30-second segments. A frame-backed capture waits for a fresh approved-surface bitmap before each segment starts. The [frame contract](docs/FRAME-CONTRACT.md) also defines a separate local owner preview that does not authorize player capture. Authenticated playback expires at its retention deadline; daily cleanup removes stored bytes and retries failures. Agent recordings remain separate. Before/after comparisons are observational.

## Provider details and verification

See [integration setup and constraints](docs/INTEGRATIONS.md), [scope and acceptance](docs/PRD.md), and [implementation context](docs/CONTEXT.md).

`npm test` covers isolation, encrypted credentials, approval concurrency, daily queue recovery, provider adapter states, SDK/session behavior, event persistence and retention interpretation. `npm run typecheck` and `npm run build` check the application. With a running local app and `.env.local`, `npm run smoke` exercises real SDK → worker → video → clip → review boundaries, using fixture decisions only. `npx tsx tests/cloud-storage.ts` is an explicitly live infrastructure test requiring the new project's `.env.vercel.local`; it creates and deletes only its own synthetic Blob and never posts socially.

`RELEASE_BASE_URL=https://web-game-marketing.vercel.app npx tsx tests/capture-deployed.ts` runs read-only anonymous release checks. Real Google acceptance additionally requires `ALLOW_LIVE_ACCEPTANCE=true RELEASE_ACCEPTANCE_MODE=google`; it opens a browser for the owner's actual Google sign-in and saves a private 0600 browser state under ignored `work/`. Fixture capture uses `RELEASE_ACCEPTANCE_MODE=fixture` and also requires `ALLOW_LIVE_FIXTURE_WRITES=true` plus the private release environment files; it creates and cleans up only its identified fixture and retains a private recovery pointer if cleanup is uncertain. A foreign-workspace check requires a second real authorized state in `work/`. A reused state does not prove a fresh Google sign-in, and a fixture does not establish Forever or Jev acceptance.

Open terminology: the requested “agent/AI-search optimization” service needs a precise definition. Native app-store optimization is excluded.
