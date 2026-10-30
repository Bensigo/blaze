# Actual workspace acceptance — 30 October 2026

This follow-up applies the shared design system to the working content flow. Local fixture screenshots are explicitly not production screenshots. No provider requests, social posts, production game URL edits or schedule activation were performed.

## Completed

- Compact idea rows show a real score or Not scored. The earlier 79 stays labelled Earlier score; its breakdown and provenance remain in the review step.
- Selected editor has Script / Jev score / Video steps. Unsaved edits survive step changes, close/reopen and workspace navigation. Reload/tab close warns while any in-memory draft remains. Drafts are not written to browser storage and are restored only after an authorized read against the same saved revision.
- Production approval requires the video step, current reviewed script, explicit acknowledgement and server readiness. Spend/overshoot/no-retry terms stay visible at approval.
- Workspace URLs retain view, known game and date range. Reload, Back and Forward restore them. Unknown/foreign games fall back to All games. Auth callback values are not copied into canonical URLs. Changing section resets scroll and focuses the main workspace.
- Optional provider/SDK explanations use focus/click/tap help. Errors, verification state and credential-save consequences remain visible.

## Verified

29 local Chromium checks cover source cancel/persistence, source facts, historical review, blocked production, dirty-score invalidation, step/close/navigation draft retention, read failure/retry, 24 reference records, mobile drawer Escape/focus, overflow, URL reload/Back/Forward and scroll/focus. A separate browser check proves a closed dirty editor still warns on reload and retains its draft if dismissed. No browser exceptions. Local fixture only; paid dispatch routes blocked.

Full suite: 540 tests in 93 files passed. Typecheck and production build passed.

Read-only independent reviews found no remaining code or visual blocker after fixing draft loss. Desktop and 390px screenshots: [content](evidence/workspace-content-local.png), [script](evidence/workspace-script-local.png), [review](evidence/workspace-review-local.png), [mobile script](evidence/workspace-script-mobile-local.png).

## Still incomplete

Authenticated production acceptance is blocked because the Mac locked again; normal Dia inspection reports manual unlock required. This follow-up is not yet deployed. Existing published release is c1a0839.

No real cloud gameplay video exists. Remaining gates are existing-key organization/provider linkage, reviewed current game network policy, independently provisioned/validated watchdog and explicit activation approval, a fresh current-reference Jev review, then a separate exact single-use cloud pilot approval. Previous review grants are consumed. The proposed $1 Anthropic list-cost threshold can overshoot and is not a hard spending ceiling. See CONTENT-STUDIO-PILOT.md and CONTENT-STUDIO-ROLLOUT.md. All metered and automatic switches remain off; calendar means manual-post planning.
