# Blaze implementation context

Approved scope (9 November 2026): open-source web-game analytics, SEO and AEO; MIT license; read-only MCP access for external agents. This supersedes previous Content Studio, marketing automation and in-product AI proposals.

Next.js App Router and TypeScript serve authenticated multi-game workspaces. Local PGlite supports development/test; production uses PostgreSQL and server-verified Neon Managed Better Auth identities. Workspace identity comes from trusted server state, never a request parameter. Provider credential storage is retained for authorized Search Console access only.

The browser SDK validates origins, bounds and deduplicates batches, sanitizes properties, gates collection on consent and separates human from synthetic traffic. Browser labels are not bot detection. SQL computes aggregates, ordered funnels and mature return cohorts. Active-play measurements and coverage remain distinct from session elapsed time. Player canvas capture remains separately consented, private, bounded and retention-limited. Retired agent video and player capture are different paths.

Discovery uses safe public fetching and a standalone static page parser. Search Console supplies authorized Web observations, which do not isolate every AI surface. Owner-reported Bing AI Performance counts are labeled as unverified and limited to their source/date/page. No model inference, generic AEO visibility score or ranking guarantee is implemented. See SEO-AEO.md.

The local stdio MCP bridge reads authenticated HTTPS report endpoints. Tokens are hashed, workspace-bound, revocable and expire after 90 days. Tools list games and read aggregate analytics or cached discovery/citation evidence; they cannot refresh scans or change data. All external page material is untrusted data. See MCP.md.

Cleanup preserves legacy database rows for owner recovery without enabling old content or social execution. No destructive schema migration is part of the pivot. Netlify's daily function only cleans retention/auth/rate state; obsolete consumer/watchdog functions are inert. Other hosts must schedule authenticated cleanup themselves. Public-page scans are manual.

Keep Forever's existing SDK, frame and manifest integration contracts compatible. No Forever production changes belong to this repository cleanup. Real provider/account, physical-device and production deployment acceptance must be reported separately from controlled local tests.
