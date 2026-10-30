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

- `BLAZE_CLOUD_PRODUCTION_ENABLED` and `BLAZE_DAILY_IDEAS_ENABLED` are unset/false by default. No worker or recurring trigger is started by this change.
- Saving daily preferences always pauses execution. It does not create spend authorization. No clock time is invented; the owner may save a Dubai time.
- The daily runner additionally requires an unexpired `daily_idea_authorization` matching `ideaScheduleHash(schedule)`, the exact AI settings revision and credential version. Its output-token bound is not a dollar cap. No authorization record is created by this feature.
- The producer additionally requires a `content_provider/default` record with existing direct Anthropic connection ID, pinned agent/version, restricted environment ID, revision, verified organization/network/pilot/watchdog flags and `reviewedGames[gameId]` matching the current source revision. Required game audio needs its own verified capability. No provider configuration is created or enabled by this feature.
- `scripts/export-gameplay-agent.ts` prints a non-secret definition for review; it does not create an agent, environment, vault, key or session. It explicitly disables workflows, subagents and advisors.
- `POST /api/cron/content-ideas` is authenticated and provided as a scheduling seam only. No Netlify/other schedule is registered. It remains paused without the execution flag and approved authorization.

## Failures, concurrency and cancellation

Repeated approval request IDs return the existing attempt; different tabs also serialize against the same idea. Different settings cannot silently reuse an active approval. The transition to `starting` is durable before the single create request. Any uncertain result requires console reconciliation and can never be automatically retried. An interrupted start without a saved session ID stays blocked from further spend.

Cancellation before dispatch consumes approval locally. Cancellation after dispatch sends only `user.interrupt`, preserves a `cancel_requested` marker even if session creation races it, and waits for an observed idle/terminated state before reporting cancelled. No follow-up prompt resumes the agent. The reviewed producer configuration must keep orchestration disabled: interrupting an orchestration-enabled session is insufficient to prove its workflows stopped.

The system prompt requests a 30-minute stop. An independent enforced cloud watchdog is **not implemented**; readiness additionally requires `watchdogVerified` and this dependency must be resolved before enabling production. No claim of a hard 30-minute runtime limit is made. Provider-side transient rescheduling behavior also needs pilot inspection; application-level retries are disabled.

Output import has a separate durable reservation and can recover an already saved video with evidence without creating a new session. Missing files after idle remain pending because Files API uploads can arrive later. An interrupted incomplete import requires reconciliation.

## Delete and restore game

Games → Manage games → Delete game requires the exact current game title. It moves the game to `archived_game` atomically, removes active dashboard/idea eligibility, consumes unstarted producer approvals and fails queued jobs. Events, identities, media, profiles and content are retained. Dashboard analytics exclude archived games. Restore retains the original ID/SDK key and does not requeue cancelled work; recording automation remains off.

Deletion is blocked while a recording, daily idea batch, claimed worker job or cloud video run is active/uncertain. This avoids falsely claiming external work stopped. Only controlled local fixture data was deleted/restored during acceptance; no production game deletion is authorized by the feature request.

## Current proof boundary and setup blockers

Local unit/integration tests and browser acceptance are separate from an actual Anthropic cloud recording. No live metered production, recurring idea run, Jev/OpenRouter call, new credential, deployment or social request is part of acceptance.

The actual Dia console screenshot showed `$260.73`, Default workspace and Sigo's individual organization. This verifies the displayed number only, not recurring-credit eligibility/expiry or which organization the existing Blaze key uses. Initial native navigation failed with `noWindowsAvailable`. After rebinding Dia, automatic approval review denied selecting the credential-vault tab because of possible secret exposure. No credentials were revealed/created. A permitted non-secret account/agent view or owner inspection is needed to finish account linkage.

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
- Actual encoded H.264 MP4 was checked for dimensions, duration and required audio. A mocked session-scoped Files response was imported through real private local storage and served with an actual byte-range response. This is parser/storage integration proof, **not** real cloud gameplay proof.
- Browser: local development sign-in; game-specific source outlines; settings/one-attempt acknowledgement; disabled unconfigured paid generation; desktop and 390px mobile layout with document width exactly 390px; delete confirmation disabled until exact name; cancel preserved game; confirmed recoverable deletion removed active game; restore returned it. Only the controlled local fixture was changed.
- Screenshots: `output/playwright/content-studio-desktop.png`, `content-studio-mobile.png`, `deleted-game.png`, `restored-game.png`.
- GitHub main was read-only verified at `c8f7d40e0f798134ae5414fd62b8c2fc89a53329`; the original `/Users/macbook/work/web-game-marketing` remained clean. No PR publication, merge or deployment was performed.
