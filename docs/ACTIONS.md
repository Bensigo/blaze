# Actions and execution evidence

Actions projects the existing Finding, research history, recording and Measurement records. It does not create a second recommendation store. Suggestions remain proposals: observations retain source/time, impact is a hypothesis, effort can be unknown, and release comparisons show association rather than causation. Start, defer, dismiss, reopen and resolve preserve owner decisions and notes. A comparison is scoped to the finding and its game.

`GET /api/execution` is authenticated, workspace scoped and metadata only. It does not decrypt credentials or call a provider. Saved settings, metadata validation, dispatch markers, HTTP responses and completed validated reviews are separate states. The latest requested AI review can fail before dispatch even when an older review succeeded. A dispatch marker is written immediately before fetch; a process crash in that interval is possible. Legacy coverage does not establish a historical inference attempt. Worker heartbeat freshness does not establish hosting or game-adapter acceptance.

Public evidence checks and daily reviews do not automatically run AI when a key is saved. An explicit AI review uses the selected AI SDK provider/model, same-game evidence and 90-day history, at most four dispatches and no automatic retries. Manual review keys are distinct, including two reviews in the same minute; the per-game daily rate limit still applies. Provider failures use safe error codes rather than response bodies.

## Gameplay and paid verification

Worker traces preserve a bounded action ID, prior phase and observed next phase, or an explicit unobserved/failure result. Completion validates ownership, media kind, action/trace alignment and the active lease. Recording state, Finding inserts, completed job and released gate commit atomically; a failed insert can be retried without partial completion. Duplicate evidence never overwrites owner decisions. A fixture or single synthetic observation is not a confirmed game bug or human enjoyment proof.

Paid Jev execution is currently blocked unconditionally at manual, scheduled and direct enqueue paths and at claims of already queued Jev jobs, before credentials are returned. There is no environment switch that pretends a budget has been verified. A separately approved implementation with an enforceable provider-side total cap is required to lift this guard. No always-on worker host or live game-adapter acceptance was established by this release. Game-side Forever changes belong to its separate owner.

| Service | Endpoint/model | Implemented request/resource bound | Missing total-cost boundary |
| --- | --- | --- | --- |
| Jev | OpenRouter `POST /api/v1/systemone`, pinned `typesafe/jev-1.13` or `typesafe/jev-1.14` | Prepared one-action mode permits at most one decision request; a forced action may need none. The action window is 30 seconds, not a whole-job deadline. Current paid guard permits zero live calls. | No verified hard input-token allowance or total credit/dollar cap including extras. Output is a decision; zero posted output price is not a spend cap. |
| X identity | `GET /2/users/me` after separate feedback OAuth | At most one returned user per identity lookup. Current paid guard permits zero live calls. | Identity, OAuth/refresh behavior and account fees must be included in an approved enforceable total cap. |
| X feedback | `GET /2/tweets/search/recent` | One manual request, at most ten posts, no expanded users, pagination or automatic collection. Current paid guard permits zero live calls. | Read-only OAuth does not establish search entitlement or available credits. Extra charges and a hard total cap are unverified. |

On 29 October 2026 the [Jev 1.14 endpoint metadata](https://openrouter.ai/api/v1/models/typesafe/jev-1.14/endpoints) listed TypeSafe input pricing at $0.042 per million tokens and output at $0. A hypothetical 1,000 input tokens costs $0.000042 before extras; actual input size is not a verified token cap. Credit-purchase fees and other account charges are separate. [X's official pricing](https://docs.x.com/x-api/getting-started/pricing) listed $0.005 per post and $0.010 per user. Ten posts plus one identity user is a $0.06 reference estimate, not an approved total budget. Recheck prices and enforce the total cap before requesting a real paid test. See [X feedback](X-FEEDBACK.md) and [worker deployment](WORKER.md).

## Most played games

The overview ranks games by distinct browser-scoped IDs in sessions containing `round_start`, then played sessions and round starts. IDs are not guaranteed people; visits are not play. Measured active play has an explicit coverage denominator, and missing measurement remains unknown. Game, date range and workspace filters apply in both SQL and local projections. Deduplication, mixed synthetic sessions and marked tests/fixtures are covered by tests. A loading scope never displays the previous game's ranking under a new filter.

`Blaze.init({ ..., test: true })` marks consented test traffic and separates its local session identity. Ranking excludes such sessions. Other existing analytics are not universally filtered by this flag, and unmarked test traffic cannot be reliably identified.

## Acceptance boundary

Controlled desktop and 390-pixel iframe checks cover ranking, Actions, preserved decisions/notes, mocked AI success and billing failure, information controls and navigation. Local database tests cover atomic rollback/retry and cross-workspace media rejection. The controlled decision driver and game-state trace do not establish the isolated background worker, live Jev inference, X entitlement, human conversion or physical-phone acceptance. Production release receipts separately identify the deployed source SHA and anonymous route/asset checks.
