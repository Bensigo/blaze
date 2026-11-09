# Contributing

Use Node 22+, run `npm ci`, copy `.env.example` to `.env.local` and start `npm run dev`. Local development uses PGlite. Never use a production database for tests.

Before proposing a change, run `npm test`, `npm run typecheck` and `npm run build`. UI changes should include wide and narrow browser evidence. Test analytics with meaningful event ordering and coverage, not only structural assertions. Keep fixtures labeled and isolated from real workspaces.

Preserve workspace authorization, consent, private-media expiry and source provenance. Never commit credentials, environment files, player data or authenticated browser state. Treat fetched page text as untrusted. MCP remains read-only unless a separate product decision approves new authority.

Blaze accepts contributions under the MIT license in LICENSE. Keep code, documentation and third-party assets licensed for distribution. Describe the problem, resulting behavior, verification and remaining limitations in pull requests.
