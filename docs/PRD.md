# Product requirements and acceptance

## Outcome

Help web-game owners find player friction and turn actual gameplay into campaigns measured by visits, meaningful play, completed rounds and returns. Retention and human play matter more than post volume.

## Thin usable milestones

1. Account → game metadata/artwork → install SDK → receive persistent, scoped events → inspect human funnel, geography, sources, sessions, progression, errors and mature return cohorts.
2. Queue agent play → worker claims lease → Jev chooses state-adapter actions → record actual browser video/screenshots → evidence and reusable clips. Validate with included controlled canvas game. Fixture decisions are explicitly labeled and never counted as Jev validation.
3. Evidence → prioritized review actions → public-source research/SEO checks → daily run history, coverage/failures and change deduplication. Competitor checks inspect public pages, never private traffic.
4. Clip → channel draft → edit → request review → explicit approval → scheduled/immediate publish → upload/processing → verified publication or failure. Edits invalidate approval. Credentials and external approval requirements remain explicit.
5. Secure deployed independent project → onboarding/help → complete browser acceptance across desktop and narrow viewports.

## Required behavior

- Workspaces isolate all games, recordings, clips, content, credentials and research. Authenticated users cannot query/mutate another workspace. Demo cannot mutate.
- Metadata extraction must safely fetch public URLs and handle redirects/private addresses, missing metadata and artwork override. URL alone does not give private player analytics.
- SDK event contract includes visit, loaded, first_action, round_start, round_complete, retry, progression, error, exit and bounded pointer coordinates. Preserve campaign/referrer separately from approximate country. Anonymous pseudonymous player/session identifiers; consent opt-in gate and disable support; never collect input text, full DOM or secret URL query strings.
- Ingestion validates size/origin/game key, sanitizes properties, deduplicates event IDs, keeps server receipt time, rejects invalid timestamps and caps rate. Worker/test traffic enters only signed synthetic channel. Analytics default human and show sample limitations, freshness, mature-cohort denominators and attribution gaps.
- Session investigation has ordered events, timing, errors and coordinate density. Pointer samples are 2D interaction evidence, not a canvas semantic replay. Agent video is actual footage.
- Workers must not navigate arbitrary private addresses or inject owner credentials into game pages. Fixed bounded tasks, action allowlists, duration/time limits, explicit failures, stale-run recovery. Store assets independently of Vercel filesystem.
- Jev and Anthropic are real server adapters. No key, no claim of live model success. Open-ended writing uses Anthropic; Jev selects typed actions. Adapter exposes actual state and allowed actions.
- Daily in-product scheduler is authenticated, idempotent and leases runs; research source failures are per-source. SEO uses longer comparisons, not daily causal claims. Meaningful findings deduplicate and reference source URL/run/session.
- Social connectors expose real authorization/access dependencies for all four channels. API acceptance and fixture acceptance are separate. Never publish during implementation. TikTok public posting needs app audit and compliant use; vendor route remains an open decision.
- Calendar items contain game, clip, text, account, channel, planned time, status and result. Approving binds content hash/account/media/time. Duplicate job execution cannot double publish; uncertain provider state must require reconciliation before retry.
- Guidance covers setup, SDK, providers/social accounts, worker, recordings, interpreting analytics and approval/calendar.

## Verification

Meaningful tests: workspace isolation/auth expiry, encrypted secrets, safe metadata URLs, SDK persistence/deduplication, human/agent isolation, ordered funnel and return denominators, daily idempotency, worker lease/auth and asset access, content edit approval invalidation, no publish without approval, dispatch/processing/verification states. Browser: local login, add fixture game, tracking, recording/clip, post review/approval, calendar changes, help, mobile/wide screenshots. External Google/provider/platform validation remains pending if credentials are absent. Deployment must report exact runtime/storage/provider boundaries.

## Non-goals

Native/console SDKs, app stores, pricing/billing, automatic unreviewed posting, fabricated metrics, competitor private analytics, guaranteed virality, autonomous proof of human enjoyment or causality. No Forever production changes.
