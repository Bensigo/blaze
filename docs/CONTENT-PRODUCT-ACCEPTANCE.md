# Content Studio product acceptance

## Implemented contract

Content Studio is the owner workspace, independent of the review vendor. Ready suggestion cards show the actual current Content score; clicking a card opens the complete editable script. Source-only manual outlines remain explicitly labelled and secondary. Generated suggestions without a current successful score live in a separate Pending section; they are never shown with a zero, invented or stale score.

- **Daily:** default two suggestions per game at08:00 Asia/Dubai (configurable), each with a complete script and a real review. One batch per game/Dubai date. A fixed seven-day dashboard grant binds exact games, source/reference revisions, provider/key/model and reviewer adapter. It reserves the disclosed daily review count under lock. New games, changed sources, expired grants and paused schedules cannot spend. No automatic video generation.
- **On demand:** choose a game, Generate content, inspect cost terms and explicitly consent to one generation plus two or three capped reviews. One request receipt survives reload/repeated clicks. Generation and scoring are separate durable phases; one scoring request per worker invocation. No automatic paid retries.
- **Feedback:** I don’t like this records the rejection, removes the suggestion and consumes unstarted approvals. It preserves scripts, finished videos, current active jobs and owner history. Recent scoped feedback and existing ideas guide subsequent prompts; exact repeats are rejected. This is prompt context, not trained preferences or a promise that semantic repeats are impossible.
- **Video:** read the script/current score, choose settings and accept metered cost risk, Generate video. The approved script/review/provider/source/settings are bound. Progress updates from saved state; generation never retries after an uncertain dispatch. The resulting run receives focus, and completed output offers inline playback, MP4 download and a Dubai planning date.
- **Content bank:** the same owned ready productions are listed under Recordings & clips, including retained archived-game outputs. Playback, download, planning date, source, saved script and run linkage use the existing private media/production endpoints.
- **Actions:** existing queue-recording/browser-worker/evidence/findings/priority-board pipeline remains. During content capture the producer may report bounded observations actually visible in the final output. Owned-video observations become Actions with timestamped private media links. Errors/performance are explicitly agent reported, not confirmed human bugs; UX suggestions are hypotheses. No fabricated metrics or human impact.

Review provider identity is internal configuration/provenance. The current adapter owns request construction, endpoint, cost admission, billing validation and response parsing. Its ID/revision is bound to approvals; unsupported adapters fail closed. It is the only currently installed adapter, not a claim that another vendor is already integrated.

## Execution architecture

The paused native minute adapter calls one shared content service directly. Runtime stops have priority. It processes at most one paid generation/scoring stage per invocation; normal MP4 import continues separately. Reviews use a15-second timeout, scheduled generation20seconds, and the service avoids starting a paid stage after consuming its initial timing margin. Native scheduled functions have a30-second platform limit; database/storage work is not a hard real-time guarantee.

Interrupted import leases recover after120seconds without repeating an upload. A durable import-phase marker prevents a partial upload from falling through to another save. Interrupted generation/scoring markers become Needs attention, never another model call. Late output files remain reconcilable rather than falsely failing at a guessed delivery deadline. Missing script/source/reviewer bindings fail closed.

## Evidence matrix

| Journey | Implemented backend | Verification | Remaining live proof |
|---|---|---|---|
| On-demand ideas + scripts + score | Scoped consent, durable generation/scoring, validated output and actual review records | Mocked-provider unit/integration and browser | Metered activation and real batch |
| Daily ready suggestions | Two/three per game/date; scoped7-day grant; generated scripts + staged scoring | Mocked runner/grant tests | Owner-approved live schedule |
| Reject / edit / re-review | Persisted history; shared locks; stale approvals consumed | Tests and local browser | No paid run needed for rejection |
| Cloud production | Single-use consent, guarded start, deadline/cancel/reconciliation/import | Mocked backend and browser | Actual cloud play/WebGL/capture/edit pilot |
| Preview / bank / download / calendar | Same private ready production across views | Local synthetic MP4 playback, bank/mobile browser; authorization tests | Actual pilot MP4 in owner dashboard |
| Actions | Existing recording pipeline plus content-video observations | Scoped findings fixtures and existing pipeline tests | Actual worker play/findings acceptance |

Synthetic fixture screenshots and scores are clearly local tests. They are not the requested real Dog Chase video. See task-root product-flow-* and product-generation-bank-browser.log; final results must be taken from completed logs, not intermediate runs while code was changing.

## One operational commissioning bundle (still pending)

Publish the consolidated app and activate the one fixed-workspace native content service. Enable owner on-demand/review and daily-plan capabilities; actual on-demand and daily metered calls still require the dashboard consents above. Leave all unrelated legacy/social automation off. No new credentials, billing plan, funds or subscriptions.

Use the existing actual78 review and unchanged Dog Chase script revision77f733a43123918d41da620dea7a241d60ac79e2705d477a61b3ff80d96c6565 for exactly one20s9:16 cloud gameplay pilot: minimal captions, restrained motion graphics, quiet generated music, native audio off. Existing agent/environment and two reviewed game hosts only. No retry, resume, parallel session, budget increase or new review. Validate real active play, raw capture, edited MP4, monitoring, private import, owner playback/download and calendar. Mark only what that run actually proves before ordinary video service is commissioned for the verified source.

The provider list-cost threshold is$1, NOT an enforceable final spending cap. An in-flight model request can overshoot it. Existing promotional balance was observed$260.72, with$0 purchased and no payment method shown; eligibility/expiry applies. A30-minute running session adds$0.04 runtime at$0.08/hour, plus token costs. Published Opus5.5 producer prices were$4/Minput,$20/Moutput. No guaranteed final-dollar upper bound has been established.

Idea/script generation has a32,000 UTF-8 content-byte limit and up to4,000 output tokens, not an exact input-token or monetary ceiling. The dashboard discloses variable generation cost and separately caps each current OpenRouter review at$0.01. A daily plan lists its exact maximum review count for seven days; the owner can pause it in Blaze. No daily plan is activated by this implementation.

Observed Netlify Legacy Free allowance:125,000 functions and100GB-hours/month. One minute service is43,200 invocations/30days (34.6% of invocation allowance), plus owner/API requests. No credit-plan pricing assumptions or paid overages are requested. Quota exhaustion/outages may pause the site/monitor. Monitoring failure blocks new sessions but cannot guarantee a stop during an outage. New paid attempts are never an automatic recovery mechanism.

## Completed local verification

- Full suite:104files,590tests passed.
- Final expiry/recovery affected suites:44tests passed after the last safety corrections.
- Browser:22review/video checks and10generation/score/rejection/bank checks, including playable synthetic MP4 and mobile overflow. Paid endpoints intercepted; production writes0.
- Typecheck and production build passed. Native function package built successfully (9,416,488 bytes); adapter remains in the paused directory. Logs recorded in task-root product-flow-build.log/product-flow-function-build.log.
- Focused independent reviews identified and closed credential/source and lock-wait expiry races.
- Screenshots:docs/evidence/product-{score,bank}-{desktop,mobile}-fixture.png. LOCAL MOCK provider and local workspace labels distinguish these from live acceptance.

Saved-score recovery can complete an interrupted batch from existing current reviews without another model request. Daily plan expiry/renewal is visible in the dashboard; renewal uses fresh consent and never extends an old request receipt. Ready cards exclude unscored manual drafts.
