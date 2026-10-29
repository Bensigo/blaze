# One serial Jev validation — approval proposal

This is a prepared option, not approval or proof that a worker has run. It changes no provider budget, credential, access or account setting. Recurring play is outside this one-run scope. Forever SDK/adapters remain a separate Bensigo/Claude handoff.

## Provider controls and residual exposure

OpenRouter documents a key's own credit ceiling and reset interval; `GET /api/v1/key` also reports applicable budgets and the effective blocking budget. The app reads only allowlisted numeric/control fields and omits key labels, fragments and provider IDs. [Key controls](https://openrouter.ai/docs/guides/best-practices/capping-shared-agent-keys), [limits](https://openrouter.ai/docs/api_reference/limits).

System One uses the same OpenRouter key/account billing as the Decisions API. This implementation sends the selected OpenRouter key to the pinned System One endpoint and supplies no separate provider key. BYOK inclusion is displayed, not imposed as an extra setup rule for this native path. [Jev billing and endpoints](https://openrouter.ai/docs/guides/community/jev).

The documented workspace-budget warning permits already-dispatched requests to settle beyond a threshold. Its exact effect on this Jev/per-key path is not live-validated. Other callers, account auto-recharge, credit-purchase fees and unreported request charges are not capped by a local request counter. The provider key ceiling is not represented as an exact all-in cash guarantee. [Workspace settlement warning](https://openrouter.ai/docs/guides/features/workspaces/workspace-budgets).

## Smallest proposed run

| Item | Bound or evidence |
| --- | --- |
| Provider / model | OpenRouter → TypeSafe, pinned `typesafe/jev-1.14`; no fallback/router alias |
| Endpoint | `POST https://openrouter.ai/api/v1/systemone` |
| Target | Blaze-owned HTTPS `/fixture/decision-validation.html`; import its `/forever.json` metadata, then approve that exact URL/manifest/network configuration |
| Decision/action calls | One serial decision request, one action, no retries; no unrelated job claim or global scheduler/content/publishing work |
| Input | At most 8,000 UTF-16 state units, 2–20 bounded choices, one question, and 16,384 UTF-8 bytes for the full JSON request |
| Output | One valid selected action ID; response transport at most 65,536 bytes. No smaller provider input/output token parameter has been established. Byte/character limits are not token caps. |
| Time | Thirty-second action window, provider request timeout at most 12 seconds. Navigation, cleanup and media upload are outside that action-window bound. |
| Price | Current metadata reference: $0.042/million input tokens and $0 output. Full published 262,144-token context would be about $0.0111 inference; use $0.02 as a conservative inference-only planning estimate, not a total cap. The smaller transport request should normally use less; tokenization/overhead and other charges are not proven. [Endpoint pricing metadata](https://openrouter.ai/api/v1/models/typesafe/jev-1.14/endpoints) |
| Existing allowance | Review the actual selected key's existing lifetime ceiling/remaining allowance. No arbitrary lower ceiling, BYOK toggle or new credential is required by this proposal. Private operator observations remain in the local handover, outside this repository. |

Key/model/control/rate snapshots are rechecked at approval, queue, claim and immediately before the worker's provider request. Queue reservation and job creation commit together. The late request slot is consumed atomically once; a lost response or timeout requires review and another explicit approval. Expiry, revocation, changed target, stale lease or changed rates stop the next stage. Authorization cannot recall an already-dispatched request or erase settled charges.

## Existing-Mac option, kept stopped

Use the existing Docker host and `compose.worker.yml` plus `compose.validation.yml`. The override requires the exact queued recording ID, disables restart, and makes the worker exit after that single claim/job. The browser remains on the internal network behind the authenticated egress guard. Use only existing private worker/egress configuration; do not pass the full web-server runtime environment or database/storage administrator secrets into containers. If the private egress configuration is missing, resolve that prerequisite before startup; this task does not generate a credential.

Future approved command shape:

```sh
# After a separate approval, build the reviewed clean revision locally:
# docker build --label org.opencontainers.image.revision=REVIEWED_SHA -t blaze-worker:validation-REVIEWED_SHA -f worker/Dockerfile .
# Then reuse existing stopped-stack secrets internally for exactly one queued job:
BLAZE_VALIDATION_IMAGE=blaze-worker:validation-REVIEWED_SHA node scripts/validation-worker.mjs --run rec_REVIEWED_ID
```

The operator must stop the browser and guard after the worker exits. An ordinary polling worker is not the one-test option: it can process other authorized background work. No Docker build or startup was performed for this proposal. A read-only check found the existing Mac Docker stack stopped with compatible configuration fields present; values were not printed. The old image does not establish the new protocol and must be rebuilt from the reviewed source after approval. Readiness still needs valid existing private worker/egress tokens, current `jev-budget-v1` image, a reachable permanent app, private media storage, and approved target/control snapshots.

Expected evidence: target/build label, initial two choices, selected allowed ID, exactly one late authorization and provider attempt, resulting phase (`left`→`won`, `right`→`complete`), screenshot/video, private-media readability, provider usage/allowance before and after settlement, and a labelled Finding→Action. The lab sends no SDK/telemetry. Its provenance stays controlled independently of Jev runtime and cannot qualify a real game's recurring-play readiness.

Stop on any missing prerequisite, revoked/expired approval, rate/control/target change, denied late authorization, provider error, ambiguous timeout, invalid action, missing resulting state/capture, or unexpected usage. Do not retry automatically or expand to another target. The next approval is explicitly for this one existing-Mac lab run and the disclosed existing-allowance exposure; it grants no recurring execution, budget modification, purchase, OAuth, new credential or infrastructure provision.
