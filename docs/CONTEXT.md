# Web game marketing — implementation context

Approved 28 October 2026. Independent product at `/Users/macbook/work/web-game-marketing`; working title only. New Vercel project. Never modify Forever during bootstrap. Forever is the intended first integration, not an installed integration.

## Product decisions

Web games only. Multi-game workspaces, Google login, server-held user provider keys. Own telemetry SDK. Human traffic is separated from synthetic recordings. Jev selects bounded actions from a game state/action adapter while a browser worker records real gameplay. Video recordings feed a reusable clip library, drafts, review, calendar, and approved publication. Daily in-product jobs inspect discoverability, public research sources, competitors, and telemetry; findings cite observations and distinguish hypotheses. No unreviewed publication, billing plans, spend, paid resource upgrades, or native store optimization.

## Architecture

The in-product research agent uses Vercel AI SDK 7 `ToolLoopAgent` with read-only evidence/history tools, structured proposals, a four-step limit and a 12-second deadline. Content drafts use the same SDK's Anthropic provider with the owner's encrypted key and selected model. Fresh per-game history includes bounded 90-day human aggregates, observed campaign traffic, prior post copy/status, past findings and measured changes. Raw player/session identifiers, credentials and private capture footage are excluded. Missing model access remains an explicit coverage gap; deterministic checks still run. AI suggestions require review, and no model tool can approve or publish. Jev keeps its separate TypeSafe typed-action adapter for gameplay.

Next.js App Router + TypeScript. PostgreSQL for deployed persistent state, PGlite local PostgreSQL for development/tests. Workspace-scoped document records and indexed event/session records. Google OAuth with Arctic; opaque DB sessions. AES-256-GCM encrypts credentials with an environment key. Public SDK ingestion is origin restricted, bounded, deduplicated, and never accepts synthetic flags from untrusted bodies. Worker has its own authenticated claim/upload API and bounded lease. Vercel daily Cron executes research and approved publishing checks. Always-running browser recording requires the separately run worker; Vercel is the dashboard/API host. Blob stores private assets; authenticated media routes serve them. Local files are development only.

## Shared implementation boundaries

`src/lib/types.ts` owns view contracts. `GET /api/workspace` returns WorkspaceSnapshot. `POST /api/actions` accepts `{action,...}` and returns updated data or error. Supported actions: add_game, update_game, queue_recording, create_clip, create_post, update_post, submit_review, approve_post, publish_post, delete_post, save_connection, delete_connection, run_research, update_finding. UI refreshes snapshot after mutations. Readonly illustrative demo uses `/api/demo` and carries `demo:true`; it is not real analytics. Production authentication without Google keys is a visible configuration dependency; local-only development login supports acceptance without exposing production bypasses.

## Open integration questions

Google OAuth application/client credentials; user's Jev and Anthropic keys; actual social app credentials/scopes/audit and account authorization; authorized X/Reddit research access; worker hosting and uptime; consent policy and retention preferences; precise meaning of agent/AI-search optimization. No publishing vendor selected. No arbitrary URL-only gameplay claim: games need a structured adapter or a validated DOM action strategy. Human enjoyment, causal uplift and physical-device feel need real users.

## Visual direction

The user selected a light workspace: cleaner typography, fewer boxes and more whitespace. Light grouped navigation, neutral surfaces, strong ink text, a restrained green accent and actual game art. Overview pairs readable metrics and trends with a focused game and actions; session tables, contextual media and calendar remain working surfaces. Utility copy, no homepage hero. Motion is limited to navigation, drawer, loading and direct manipulation. Inspect wide and narrow screens in a real browser.
