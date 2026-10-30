# Cloud gameplay content studio

Implementation prepared on the isolated `feat/cloud-content-studio` branch. This is not a deployment or evidence of a successful cloud gameplay run.

## Workflow

1. Each registered game supplies its own source facts from the investigated manifest/profile. Source outlines are available without a model call and are labelled accordingly.
2. The daily idea agent proposes two or three videos per game, default three, using the existing direct Anthropic selection. It cites exact source fact keys, avoids prior titles/exact idea fingerprints, records token usage and never automatically retries an interrupted/failed date. Semantic repetition and claim accuracy still require human review.
3. An owner selects an idea and reviews aspect ratio, 10–60 second duration, caption density, generated music, motion graphics, required game audio and one session's list-cost threshold. Explicit acknowledgement is required. Approval binds source revision, settings, provider revision and encrypted-key fingerprint, expires after 15 minutes and is consumed by one attempt.
4. The producer starts a pinned Anthropic Managed Agent in a reviewed cloud environment. It must actively play the actual game with Playwright/Chromium, capture raw footage, edit the approved treatment with ffmpeg, and return MP4 plus evidence. It receives no storage credentials and cannot post socially.
5. Blaze lists output files scoped to that session, downloads bounded artifacts, checks media duration/dimensions/aspect ratio/audio and stores the final MP4 through the existing private media layer. Recorded actions are agent-reported; structural checks do not independently prove gameplay authenticity. Human review remains required.
6. The owner previews, downloads and chooses a planning date in `Asia/Dubai`. This creates no post, publish approval, publishing job or social API call. X/YouTube posting is manual.

## Default-off execution

- `BLAZE_CLOUD_PRODUCTION_ENABLED`, `BLAZE_DAILY_IDEAS_ENABLED` and `BLAZE_CLOUD_WATCHDOG_ENABLED` are unset/false by default. No worker or recurring trigger is started by this change.
- Saving daily preferences always pauses execution. It does not create spend authorization. No clock time is invented; the owner may save a Dubai time.
- The daily runner additionally requires an unexpired `daily_idea_authorization` matching `ideaScheduleHash(schedule)`, the exact AI settings revision and credential version. Its output-token bound is not a dollar cap. No authorization record is created by this feature.
- The producer additionally requires a `content_provider/default` record with existing direct Anthropic connection ID, pinned agent/version, restricted environment ID, revision, verified organization/network/pilot/watchdog flags and `reviewedGames[gameId]` matching the current source revision. Required game audio needs its own verified capability. No provider configuration is created or enabled by this feature.
- `scripts/export-gameplay-agent.ts` prints a non-secret definition for review; it does not create an agent, environment, vault, key or session. It explicitly disables workflows, subagents and advisors.
- `POST /api/cron/content-ideas` is authenticated and provided as a scheduling seam only. No Netlify/other schedule is registered. It remains paused without the execution flag and approved authorization.

## Failures, concurrency and cancellation

Repeated approval request IDs return the existing attempt; different tabs also serialize against the same idea. Different settings cannot silently reuse an active approval. The transition to `starting` is durable before the single create request. Any uncertain result requires console reconciliation and can never be automatically retried. An interrupted start without a saved session ID stays blocked from further spend.

Cancellation before dispatch consumes approval locally. Cancellation after dispatch sends only `user.interrupt`, preserves a `cancel_requested` marker even if session creation races it, and waits for an observed idle/terminated state before reporting cancelled. No follow-up prompt resumes the agent. The reviewed producer configuration must keep orchestration disabled: interrupting an orchestration-enabled session is insufficient to prove its workflows stopped.

An independent durable watchdog is implemented at `POST /api/cron/content-production-watchdog`, authenticated with the existing cron token and an explicit workspace ID. It is default-off and has no installed trigger. Dispatch records an immutable 30-minute deadline. Each bounded poll leases the workspace, checks up to four due sessions, sends only a single durable `user.interrupt` request and waits for an observed idle/terminated state before reporting stopped. Interrupted/uncertain stop dispatches are not blindly repeated; unresolved sessions block fresh production. Batches rotate so a stuck session does not starve other deadlines. The producer requires both `watchdogVerified` and a healthy matching heartbeat no older than 90 seconds.

Operational activation remains pending: configure and verify an independent one-minute authenticated trigger before enabling production. With that cadence, stop is requested at/after the 30-minute deadline, not guaranteed to be completed at exactly 30 minutes. The provider may finish an in-flight tool before applying an interrupt; a real bounded pilot must establish actual stop behavior. Provider-side transient rescheduling also needs inspection. Application-level generation retries remain disabled. No trigger, daemon or paid session was started during implementation.

Output import has a separate durable reservation and can recover an already saved video with evidence without creating a new session. Missing files after idle remain pending because Files API uploads can arrive later. An interrupted incomplete import requires reconciliation.

## Delete and restore game

Games → Manage games → Delete game requires the exact current game title. It moves the game to `archived_game` atomically, removes active dashboard/idea eligibility, consumes unstarted producer approvals and fails queued jobs. Events, identities, media, profiles and content are retained. Dashboard analytics exclude archived games. Restore retains the original ID/SDK key and does not requeue cancelled work; recording automation remains off.

Deletion is blocked while a recording, daily idea batch, claimed worker job or cloud video run is active/uncertain. This avoids falsely claiming external work stopped. Only controlled local fixture data was deleted/restored during acceptance; no production game deletion is authorized by the feature request.

## Current proof boundary and setup blockers

Local unit/integration tests and browser acceptance are separate from an actual Anthropic cloud recording. No live metered production, recurring idea run, Jev/OpenRouter call, new credential, deployment or social request is part of acceptance.

After the owner reopened Dia, read-only billing inspection verified `$260.72` in promotional credits in Sigo's individual organization. The grants explicitly include Managed Agents: `$99.89` expires 7 November2026 and `$160.83` expires26 November2026 (UTC). The header independently showed `$260.73`; no billing settings were changed. Default workspace showed no active agents or environments. Blaze Account settings showed the existing direct Anthropic workspace key and `claude-haiku-5-5`. A separate READ ONLY database diagnostic reused that saved key only in memory for official `GET /v1/organizations/me`: it returned Sigo's individual organization (`37d434cc-361f-45b7-84a7-725c0d45484c`), with zero inference calls, database writes or credential changes.

After explicit user approval, the single permitted Create agent retry succeeded in the actual local Dia session. Saved agent **`agent_01BmpBeh1nD4WkrmJqPNSXMy` version1**, “Blaze gameplay video producer”, uses `claude-opus-5-5` with low effort. Only bash/read/write/edit/glob/grep are enabled; workflows/subagents/advisors, MCP servers and skills are disabled. No environment, credential or session was attached. The saved configuration and Sessions page were inspected; the latter explicitly showed “No sessions yet.” The previous automatic-review denial is resolved for definition creation only. Restricted environment configuration, runtime setup, the budgeted cloud pilot, recurring activation and release remain separately pending.

The official Obsidian CLI could not find its running app; app selection also failed screen capture. Canonical vault consultation/update remains pending. No vault save is claimed.

## Official API references checked 2026-10-30

- [Managed Agents cloud sandbox packages](https://platform.claude.com/docs/en/managed-agents/cloud-sandboxes-reference): installed Chromium, Playwright and ffmpeg; WebGL/input performance and game audio remain game-specific pilot questions.
- [Create session](https://platform.claude.com/docs/en/api/beta/sessions/create): versioned agent, initial events and budget request shape.
- [Files](https://platform.claude.com/docs/en/managed-agents/files): session-scoped outputs and downloads.
- [Budgets](https://platform.claude.com/docs/en/managed-agents/budgets): checked between model requests and may overshoot on the final request. Do not present the threshold as an exact hard invoice cap.
- [Session operations](https://platform.claude.com/docs/en/managed-agents/session-operations) and [send events](https://platform.claude.com/docs/en/api/beta/sessions/events/send): interrupt/idle semantics.

Existing subscription-credit eligibility and the provider's current pricing must be verified for the selected organization before a paid pilot. Displayed balance alone is not authorization or a billing guarantee.

## Local verification receipt

- Full local suite after deletion integration: 471 tests passed in 84 files. Follow-up targeted acceptance after the final usage/import/parser changes: 29 tests passed in six files.
- Final production build and TypeScript results are recorded in the task's `build-final.log` and `typecheck-final.log`.
- Watchdog follow-up: `watchdog-full-tests.log` passed all482 tests in86 files on the final follow-up source, including deadline/cancellation/restart/batch rotation/route authorization coverage. `watchdog-focused-final.log` separately passed eight watchdog tests; `watchdog-typecheck-final.log` and `watchdog-build.log` passed. No real cloud session was used.
- Actual encoded H.264 MP4 was checked for dimensions, duration and required audio. A mocked session-scoped Files response was imported through real private local storage and served with an actual byte-range response. This is parser/storage integration proof, **not** real cloud gameplay proof.
- Browser: local development sign-in; game-specific source outlines; settings/one-attempt acknowledgement; disabled unconfigured paid generation; desktop and 390px mobile layout with document width exactly 390px; delete confirmation disabled until exact name; cancel preserved game; confirmed recoverable deletion removed active game; restore returned it. Only the controlled local fixture was changed.
- Screenshots: `output/playwright/content-studio-desktop.png`, `content-studio-mobile.png`, `deleted-game.png`, `restored-game.png`.
- GitHub main was read-only verified at `c8f7d40e0f798134ae5414fd62b8c2fc89a53329`; the original `/Users/macbook/work/web-game-marketing` remained clean. No PR publication, merge or deployment was performed.

The saved Anthropic key also returned HTTP200 from the read-only Managed Agents list endpoint (`GET /v1/agents?limit=1`). This verifies metadata access with the existing credential, not permission to create a persistent agent, run inference, expand access or activate a schedule.

## Concrete rollout preparation

See `CONTENT-STUDIO-ROLLOUT.md` for verified workspace/connection/game IDs, observed WHOT redirect and guest resource hosts, non-secret storage destination, and exact provider schema. The native one-minute adapter is prepared under `netlify/paused-functions`, outside deployment discovery, so releasing this slice cannot register its cron. Both schedule and route flags default off. Normal generation still requires verified pilot readiness; a dedicated first-pilot admission path is not implemented and must not be replaced by prematurely setting verification flags. Actual Netlify plan/allowance inspection was blocked by automatic review of a broad Dia read; no retry or workaround was attempted. No provider call or production write occurred in readiness preparation.
