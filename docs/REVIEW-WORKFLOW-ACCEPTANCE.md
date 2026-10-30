# Review progression correction — 30 October 2026

The owner's screenshot showed a checked acknowledgement beside a globally paused paid review, and an enabled Continue to video despite no score. The screenshot was inspected from its exact authorized Library file before the fix. It is not committed because it is user-supplied browser content.

## Result

- The metered action is named Request review. Review cost only prepares the cost/version quote; it does not charge or start a review.
- Paused reviews disable both the acknowledgement and Request review, with an explicit reason. Refresh review status is a read-only recovery action.
- API availability uses the same global flag and workspace active/uncertain/cost-violation hold as approval/dispatch. It does not claim readiness based only on the global flag.
- Script must be saved against current source/reference context before continuing from editing. Video navigation and Continue to video remain disabled until the exact saved script/source/review context has a completed score. Pending, failed, missing, stale, edited and errored reads cannot advance.
- Video navigation never starts generation. Production still requires its separate settings, acknowledgement, readiness and backend checks.

## Evidence

544 tests in 94 files, typecheck and production build passed.

16 local Chromium checks passed, with paid endpoints intercepted using explicit local fixtures. They cover the real paused GET metadata, Request review naming/disabled controls, double-click one-start behavior, pending/failed/current/stale/edited review progression, status refresh without resend and mobile overflow. No real provider calls or production writes were made by browser tests.

Independent code review found an availability mismatch; sharing the backend workspace hold predicate corrected it. Independent screenshot/accessibility review found no remaining visual blocker. Screenshots: [paused desktop](evidence/review-gating-paused-local.png), [mobile](evidence/review-gating-mobile-local.png). These are local fixture captures, not production.

A read-only production receipt check found only the previously completed historical79 Dog Chase review; no new review grant/start appeared from the reported clicks at inspection time. This is not authorization for a new call. Exact current paid-review approval remains a separate gate.
