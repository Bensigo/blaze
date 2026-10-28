# Implementation rules

Working scope: docs/CONTEXT.md and docs/PRD.md. Main executor owns integration and deploy. Use GPT-6.1 Terra for bounded implementation/review tasks per user requirement. Never disclose secrets or publish social posts in tests. Scope every record to workspace; default analytics to humans. Clearly label fixtures/demo and disconnected integration states. Preserve concurrent edits. Keep agent file ownership separate. Run typecheck, meaningful tests, build and browser acceptance before deployment.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
