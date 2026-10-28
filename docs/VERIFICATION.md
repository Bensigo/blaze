# Verification — 28 October 2026

App: https://web-game-marketing.vercel.app. Independent source: `/Users/macbook/work/web-game-marketing`.

## Current source checks

- 77 tests across 17 suites pass. Coverage includes account/game isolation, encrypted secrets, consented SDK ingestion, ordered analytics, approval/publication concurrency, durable queues, private capture grants/playback/cancellation/expiry, storage-intent recovery, real video metadata limits, guarded HTTPS/WSS, and the AI SDK tool loop and historical context.
- TypeScript and the optimized Next.js 16.4.3 production build pass. Production dependency audit reports zero vulnerabilities.
- AI SDK 7.0.155 and its Anthropic provider power the bounded research agent and draft generation. Tests execute the actual SDK with controlled model/provider responses, including tools, evidence validation, step bounds, missing/offline providers, fresh game history, foreign-workspace/game exclusion, separate history caps, and preservation of resolved findings. No live Anthropic or Jev decision is claimed.
- A real local browser sent explicitly consented game-canvas footage through the capture API and private storage. The one-second WebM decoded correctly, contained no audio, masked a painted private region black, and excluded HTML inputs/chat. Owner playback/range reads worked; anonymous access and access after cancellation were denied. Foreign/worker/public-share/expired access and the cancel/upload race have route/service tests.
- Authenticated Sessions playback and real event click-to-seek were checked: an actual delayed-grant capture sought to 0.542 seconds using the recorder start timestamp; the old grant-time offset would have been 1.173 seconds. Legacy timing is explicitly approximate.
- All ten UI destinations were checked at 1440×900, 1024×768 and 390×844. Global overflow was fixed; wide tables/calendar scroll internally. Focused game filtering and analytics/record actions worked. No page exceptions were observed. Screenshots show the user-selected light design.
- Real Chromium tests exercised separate controlled TLS origins, an actual WebSocket handshake, redirect enforcement, public-address validation, the egress proxy, a remote browser and video transfer. Loopback remapping/self-signed allowances are test-only.

## Container acceptance limitation

The Docker firewall/container topology remains unverified. Docker Desktop was started within authorization, but its socket and read-only cached-image queries timed out. After deletion of only the two explicitly approved generated `.next` folders, a repeat ping still timed out after five seconds and cached-image inspection after eight seconds (396 MiB then free). No Docker pulls, builds, containers or cleanup were performed for this acceptance attempt. Existing workloads were preserved. Arbitrary-game recording requires the isolated browser/guard and fails closed when unavailable; select a healthy persistent host and verify the topology before operating it.

## Deployment evidence

The initial production release verified dedicated Neon PostgreSQL, private Blob storage, actual controlled browser/agent video and a portrait clip, authenticated ranges, public metadata/SEO fetching and daily cron authorization. Those earlier fixture artifacts remain labeled by their evidence files.

The final release revision, deployment identity, readiness, production acceptance and runtime-log result are recorded in the task outputs `revision-alignment.json`, `release-checks.json`, `human-capture-production-evidence.json` and `runtime-check.json`. They must be checked after deployment; local checks alone do not establish production acceptance.

## External acceptance and setup

- Google OAuth owner app credentials and a real Google-account sign-in remain required. Production development login must stay unavailable.
- Anthropic/Jev keys and a selected available model/validated game adapter are required for live model calls. Missing AI access appears as a coverage gap while deterministic research remains available.
- Authorized X/Reddit, optional Brave and Search Console access are needed for those sources. No fabricated mentions, private competitor traffic or ranking results are used.
- Publishing needs actual authorized account tokens/scopes and platform app configuration/reviews. TikTok additionally needs per-post creator choices/consent and appropriate audit. Native social OAuth onboarding and automatic token refresh are not implemented. No social post was published during tests.
- Worker hosting/uptime is still a deployment choice. Vercel runs the dashboard/API and daily cron, not a continuously running recording browser. Offline recording/clip jobs wait.
- Install the SDK and adapter in the owning actual game project; Forever was not modified here. Physical-device feel, audio, fun/retention and causal improvement remain unestablished by controlled browser tests.

History uses bounded 90-day human aggregates and existing posts/findings/measurements. Observed campaign traffic is not causal content uplift; unpublished drafts are not failed posts, resolved findings are not proof of success, and social impressions/likes are unavailable.
