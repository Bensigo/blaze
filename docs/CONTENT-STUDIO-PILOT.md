# Proposed first cloud gameplay pilot — not authorized or executed

This is one bounded feasibility test of the requested workflow. Creating the producer definition did not approve a session, environment, recurring trigger, new credentials, release or retry.

## Target and acceptance

Use the registered WHOT game at `https://forever.138-68-247-33.sslip.io/games/whot`, guest versus NPC only if that mode is actually available. The cloud browser must visibly make legal game inputs and show resulting game-state changes. If login, consent, unavailable controls, WebGL or network constraints prevent that, fail once and stop. Do not modify Forever, bypass consent, interact with other players, or substitute drawn scenes or supplied footage.

One 20-second portrait 9:16 H.264 MP4 (target 720×1280), readable captions and restrained motion graphics; quiet code-generated music, native game audio explicitly off for this first attempt. Preserve raw capture and timestamped action/edit evidence in the session. This pilot will not establish native game-audio support. Confirm actual game events against raw footage manually: structural MP4 validation and the agent's own report do not prove gameplay authenticity.

After generation, the existing Blaze backend must import the session-scoped video into private storage, display preview and authenticated download, reject access from another workspace, and store a Dubai planning date. No social upload or automatic publication.

## Model and spend proposal

Pin producer `agent_01BmpBeh1nD4WkrmJqPNSXMy` version 1, `claude-opus-5-5`, low effort, no subagents/workflows/fallbacks. Propose a **$1 session list-cost threshold**, one session create, no retries or resume. Planning target is at most 50,000 input and 8,000 output tokens, about $0.36 at the verified $4/$20 per million rates, plus about $0.013 for ten minutes of running session time at $0.08/hour. These token counts are planning targets, not independent enforced cumulative caps; verify current pricing at approval time. Inspect actual usage before any further work.

Managed Agents checks its monetary budget between model requests; an in-flight request can overshoot it. This is not a guaranteed $1 invoice ceiling. The exact account credits, eligibility and expiry must still be checked at execution time. No increased threshold, new payment method, auto-reload or purchased credits is approved.

Target completion within ten minutes. The implemented watchdog requests interruption at the immutable 30-minute deadline; with one-minute polling this includes polling delay, and an in-flight tool may delay completed stop. Do not promise a ten-minute enforced cutoff or exact completed-stop time. An operator should observe this single pilot and request interruption if it is stuck. Unknown session creation or unconfirmed stop blocks all new production until reconciled.

## Prerequisites before approval/execution

1. Review and release the code separately. Current local tests do not enable the deployed product.
2. Separately approve and create a restricted cloud environment. Inspect actual game-resource and WebSocket destinations before defining a narrow allowlist. No wildcard internet access, storage secrets, login credentials, MCP servers or Forever source changes. Confirm actual Chromium, Playwright and ffmpeg support; WebGL performance is unproven.
3. Configure the reviewed provider record with the created agent/version and that environment using the existing credit-bearing Anthropic selection. Do not silently add or copy credentials.
4. Separately approve an independent authenticated one-minute cloud watchdog trigger, then exercise its no-spend heartbeat, stale/restart recovery and duplicate tick behavior. Verify 90-second heartbeat readiness and that a stale/failed monitor blocks generation. The route is default-off; no trigger currently exists. A local Mac process is not an independent cloud watchdog.
5. Approve this exact game's idea, settings, threshold, single attempt and transmission destinations. Never reuse old Jev test approval or the definition-save permission.

## Transmission, artifacts and cleanup

The public game and its explicitly approved asset/network origins are accessed from Anthropic's cloud sandbox. The approved source facts, idea and settings go to `api.anthropic.com` Managed Agents. Session outputs under `/mnt/session/outputs` are exposed by Anthropic's session-scoped Files API. Only Blaze's backend downloads them and writes the final MP4 into the existing private Neon S3 storage; the agent receives no storage credentials. Authenticated Blaze media/download routes serve it to the owner. No social service receives content.

Application limits are 150 MB final video and 128 KB evidence JSON. Prefer a final MP4 under 25 MB and raw capture under 100 MB for this pilot. Raw capture is currently referenced in scoped Files metadata and evidence; it is not downloaded/structurally validated or copied to Blaze. Retain it until manual review. A separate retention/cleanup decision is needed before relying on durable raw evidence. Do not report metadata presence as validated raw footage.

On failure, record the session identifier, provider state and observed usage, request one interruption when possible, confirm idle/terminated, retain diagnostic evidence, and stop. No automatic retry, regenerated replacement or destructive cloud cleanup. Inspect for a possibly created session before considering any further action. After accepted download, propose exact cleanup targets for owner approval; do not delete cloud resources speculatively.
