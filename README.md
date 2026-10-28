# Web Game Studio

Working name for an independent web-game marketing and player-evidence product. This repository does not change Forever.

## Run locally

Node 22+, then `npm ci`, copy `.env.example` to `.env.local`, set a random `WORKER_TOKEN`, and run `npm run dev`. Open `http://127.0.0.1:3000`. The local development sign-in is unavailable in production. PGlite persists local PostgreSQL data in `.data/postgres`; PostgreSQL is used when `DATABASE_URL` is set.

The public example workspace uses explicitly illustrative Star Catch data. It is read-only and never enters real analytics.

## First real workflow

1. Configure a Google OAuth web application with callback `<APP_URL>/api/auth/callback/google`. Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and canonical `APP_URL` on the new deployment. Each Google account receives an isolated workspace.
2. Add a public web-game URL. Its actual metadata supplies title, description and art; edit metadata, origins and artwork as needed. A URL provides no private player data.
3. Install [the SDK](docs/SDK.md), connect it to the game's meaningful actions and obtain the player's appropriate consent. Check events in Sessions and human analytics. Country comes from approximate hosting geography, while source and campaign use referral/campaign data.
4. Configure Jev, Anthropic and required research/account tokens in Connections. Tokens are encrypted server-side and verified before a connection is shown as connected. Native provider OAuth app registration and token issuance happen with the provider. Stored refresh tokens are not automatically refreshed in V1; expired access fails visibly and requires reconnection.
5. Run [the recording worker](docs/WORKER.md) on a trusted host. It polls the API, uses a structured game adapter and records actual browser video. A controlled fixture is included at `/fixture/index.html`. Fixture decisions are explicitly labeled and do not validate Jev. The worker currently blocks cross-origin resources and WebSockets, so third-party game compatibility requires deliberate validation.
6. Create landscape, square or portrait clips. Portrait/square use padding, preserving the full gameplay image. V1 clips have no audio track; actual phone audio and human enjoyment remain untested.
7. Create a channel draft, insert its tracked link, select a verified account, and request review. Review the exact text, clip, account, time and TikTok creator settings if applicable. Approval binds those fields. Editing clears approval. Publish approved items immediately or at the approved scheduled time.

## Runtime boundaries

- Vercel hosts the dashboard and API, with a dedicated Neon Free PostgreSQL database and private Blob store.
- The deployed Vercel Cron checks daily at 06:00 UTC. It durably queues all enabled games and processes three per invocation. The separately running worker drains additional queued games. Run history distinguishes missing sources, failure and partial coverage. SEO baselines use weekly changes; Search Console compares finalized 28-day windows.
- The worker is required for gameplay recording, clip encoding, extra research queue work and minute-level scheduled publication checks. When it is offline, those jobs wait; the daily cron still handles its bounded research work and due publication checks. Vercel is not an always-running browser worker.
- Worker uploads can go directly to private Blob to avoid Vercel's request body limit. Private media routes enforce account access and byte ranges; publishing gets a short-lived signed transfer URL only where needed.
- Google sign-in, Jev decisions, Anthropic prose, authorized research and each publishing destination need their own genuine credentials/scopes. No social post is published during tests. TikTok public posting also needs an audited compliant app. No publishing vendor was selected.

## Analytics interpretation

Human reports exclude server-issued agent sessions. Event ingestion validates game origin and schema and deduplicates IDs, but public browser telemetry is not a verified human identity or fraud detector. Funnels require event order within a session. Completion totals can differ from the funnel when earlier instrumentation is absent.

Returning players need a distinct later session at least 24 hours after first observation. D1 retention uses a distinct visit in the 24–48 hour window, and only cohorts at least 48 hours old enter the denominator. Player IDs are anonymous browser/device identifiers, not cross-device accounts. Ad blockers, consent refusal, cleared storage, absent SDK events and platform referrer policies create coverage gaps.

Pointer density is a normalized 2D interaction view, not a semantic canvas replay. Human sessions have event timelines; automatic human gameplay video/session replay is not installed by default. Agent recordings are actual footage. Before/after game-change comparisons show samples and elapsed windows; they do not establish causality or prove human fun/retention.

## Provider details and verification

See [integration setup and constraints](docs/INTEGRATIONS.md), [scope and acceptance](docs/PRD.md), and [implementation context](docs/CONTEXT.md).

`npm test` covers isolation, encrypted credentials, approval concurrency, daily queue recovery, provider adapter states, SDK/session behavior, event persistence and retention interpretation. `npm run typecheck` and `npm run build` check the application. With a running local app and `.env.local`, `npm run smoke` exercises real SDK → worker → video → clip → review boundaries, using fixture decisions only. `npx tsx tests/cloud-storage.ts` is an explicitly live infrastructure test requiring the new project's `.env.vercel.local`; it creates and deletes only its own synthetic Blob and never posts socially.

Open terminology: the requested “agent/AI-search optimization” service needs a precise definition. Native app-store optimization is excluded.
