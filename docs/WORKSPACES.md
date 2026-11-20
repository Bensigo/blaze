# Workspaces

An account can have up to 10 workspaces. Each keeps its own games, events, connections, findings and agent tokens; nothing is shared between them.

- **Home workspace**: the account's first workspace (`users.workspace_id`), made at first sign-in. It is named "Your workspace" until renamed.
- **More workspaces**: the sidebar's workspace button → **New workspace**. They are stored in `records`, scoped to the workspace itself: `(workspace, 'workspace', 'meta')` holds the name, `(workspace, 'member', <user id>)` one row per member. No schema migration.
- **Active workspace**: the `blaze_workspace` cookie (httpOnly, a year) names it. `identity()` checks membership on every request and falls back to the home workspace, so a forged or stale cookie never opens someone else's data. Every route keeps using `identity.workspace_id`; `identity.home_workspace_id` is the home one.
- **API**: `GET /api/workspaces` lists them; `POST /api/workspaces` with `{action:"create", name}` (also switches to it), `{action:"switch", id}` or `{action:"rename", id, name}`. Same-origin only, 30 requests a minute per account.
- **Agent tokens** (MCP) belong to the workspace that was active when they were made. Make one in each workspace you want an agent to read.

Not built yet: inviting other people, leaving or deleting a workspace, moving a game between workspaces.
