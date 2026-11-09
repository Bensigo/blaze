# Blaze product requirements

Help web-game developers find player friction, understand acquisition and returns, and improve publicly discoverable game pages. Ship under MIT; expose read-only evidence to external agents through MCP.

## Required flows

1. Sign in → isolated workspace → add game with validated metadata/origins → install consented SDK → receive events → inspect funnel, sessions, sources, geography, devices, active play, errors, heatmaps and mature returns.
2. Public game URL → safe SEO/AEO audit → dated observations and actionable fixes → authorized Search Console evidence or explicit unavailable state → separately labeled citation evidence. Never equate readiness with measured visibility.
3. Owner creates token → external stdio MCP client lists games and reads aggregate analytics/cached search evidence → owner revokes token → next request is denied. No agent mutations or raw player identifiers/footage.
4. Optional owner-enabled player canvas capture → separate affirmative player consent → bounded private capture → owner playback only until retention expiry → cleanup. No AI gameplay recording.
5. Record an already-shipped release and explicit before/after windows → show denominators, coverage, cohort maturity and caveats. No causal claim.

## Acceptance

Preserve workspace/auth isolation, bounded ingestion and deduplication, synthetic separation, event ordering and retention semantics, explicit empty and disconnected states, safe public URL fetching and private media. Reject old AI/content/social operations. Remove their executable paths, provider packages and account settings. Verify meaningful tests, TypeScript, production build, wide/narrow browser flows and MCP protocol calls.

Self-hosting docs must describe required production database/auth, optional private media, migration and retention operations. Open-source publication requires a chosen license (MIT approved), tracked-source/history privacy review and honest disclosure of remaining operational dependencies.

## Non-goals

Model generation, automated gameplay, clip production, calendar planning, social publication, guaranteed indexing/rankings/AI citations, autonomous game modifications, cross-device identity or unsupported universal AI citation tracking.
