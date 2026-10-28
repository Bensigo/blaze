# Verification — 28 October 2026

Production: https://web-game-marketing.vercel.app

Independent local repository: `/Users/macbook/work/web-game-marketing`.

## Evidence

- 41 tests across eight suites pass. They exercise encrypted credentials/tamper rejection, account/workspace isolation and session expiry, origin validation/event deduplication/privacy filtering, ordered funnels, distinct-session mature retention, atomic recording queues, daily research queue idempotency/recovery beyond 30 games, SDK consent/inactivity rollover/timestamp ordering, worker evidence, real-adapter fixture responses, and approval/publication concurrency.
- TypeScript passes. Local optimized production build passes; the remote Vercel build also passed.
- Production dependencies: `npm audit --omit=dev` reports zero vulnerabilities, with the vulnerable transitive Zod version overridden to the patched installed version.
- Local real-browser journey: consented human SDK events persisted; agent events used a separate stream; actual video/screenshot and portrait clip reached ready state; private media accepted authenticated byte ranges and rejected unauthenticated reads. A draft could be reviewed and edited; disconnected approval/publication were denied and editing reset review. Its campaign tracking link was verified.
- Deployed isolated journey: persistent Neon PostgreSQL, real browser human session, separate worker synthetic session, actual browser video/screenshot, encoded portrait clip, direct private Blob upload and authenticated media range reads all passed. Exactly one human and one agent session existed in the isolated test workspace. Production `/api/workspace` returned 401 without authentication and `/api/auth/dev` returned 404. Its records and newly generated cloud assets were removed after the test; footage copies remain in the delivery outputs.
- Direct storage acceptance transferred a 6 MiB synthetic payload through the actual private Blob client-token/finalize path and checked a 1 KiB private range. That test Blob was deleted.
- The in-product daily cron is enabled in Vercel at `0 6 * * *` (06:00 UTC). Its unauthorized call returned 401; an authorized call returned 200 with zero enabled games after isolated release cleanup. The cron queues every game; three are checked per invocation and a running worker drains additional jobs. Publication work is bounded to one destination per tick and rotates pending checks; uncertain writes without provider IDs are held for manual reconciliation.
- Public production UI was inspected at 1440×900 and 390×844, with additional local 1920px inspection. Overview, research, calendar, recordings and missing-Google setup were checked. The illustrative workspace is labeled read-only and example data never enters owner telemetry. No runtime page exception was reported. The missing icon request observed in the initial browser pass is addressed by the app icon in the final release.

## Live external acceptance still required

- **Google**: register the owner's OAuth web app and set its client ID/secret. Callback: `https://web-game-marketing.vercel.app/api/auth/callback/google`. No real Google account sign-in was claimed.
- **Jev**: enter the owner's key and install/validate the game state/action adapter. Real model decisions remain unverified; fixture decisions prove recording mechanics only.
- **Anthropic**: enter a valid key/model and, for a multi-workspace key, workspace ID. Live writing remains unverified.
- **Research**: authorized X/Reddit, optional Brave and Search Console tokens/property access. Public-source coverage and API availability are explicit. No fabricated discussion, ranking or competitor traffic is used.
- **Publishing**: real authorized destination tokens/scopes, provider app configuration/reviews and TikTok per-post creator consent/audit where required. Social access currently uses verified token entry; native social OAuth onboarding and automatic token refresh are not implemented. Adapter tests intercept provider calls; no social post was published during implementation.
- **Worker**: select/run a trusted persistent host. The local worker used for acceptance was stopped afterward. Vercel hosts the API/dashboard and daily cron, not an always-running browser. Minute-level approved publishing checks, recordings, clips and extra queued research need the worker.
- **Actual games**: install the SDK/adapters in the owning game project. Forever was not integrated or changed in this standalone build. The worker currently blocks cross-origin game resources and WebSockets; games depending on them require a deliberately expanded and verified network policy. Arbitrary URL-only gameplay is not claimed.
- **Experience**: physical-device feel, audio, human fun/retention and causal improvement are not established by automated play. V1 clips have no audio track, and human sessions expose event investigation rather than automatic full gameplay video replay.

No final brand, billing plan, publishing intermediary or AI-search optimization service has been selected. “Web Game Studio” is the working interface label.
