# Content Studio browser evidence

These screenshots are from an isolated local development workspace. The displayed80/100 is an explicitly labelled browser-only mock response for UI verification, not a real Jev score or cloud generation result. Editing the script immediately hides the old score and disables generation. The mobile viewport/document widths were both390px.

- content-studio-script-score-fixture.png: script editor, rubric dimensions, mock score and disabled paid generation.
- content-studio-script-stale-mobile-fixture.png: edited script, stale-score notice and disabled generation on mobile.

Runtime source was tested at c3de5704d94d6d9750e8959f4658a3fc21aa9c50:518tests/89files, TypeScript and production build passed. This evidence-only commit does not change runtime source.

## Source editing and readability acceptance — 2026-10-30

The newer screenshots below use a replay of the completed real79/100 Jev response in an **isolated local fixture**, never a new provider call or a claimed production deployment:

- `content-score-readable-local.png`: readable score hierarchy, four dimensions and rubric-derived improvement.
- `game-source-mobile-local.png`: mobile source editor with save/cancel, full-width input and disclosed consequences.
- `content-score-stale-source-local.png`: historical score retained and clearly labelled stale after a seeded source-revision change. This is a render-state fixture, not evidence of a successful live manifest update.

Browser checks passed for saved script/score, exact script loading, disabled generation, unsaved-script invalidation, source cancel, private-host rejection, obsolete-error clearing, mobile overflow, persisted seeded source display, historical stale score, and disabled stale review/generation. No horizontal overflow at390px. Independent screenshot review found no clipping/overlap or readability blocker.

Successful source mutation, ownership, concurrency, history retention and stale approval behavior passed local mocked integration tests. The live public Dog Chase manifest returned HTTP502 during browser acceptance, so the real-source save was correctly refused; the owner's actual registered URL was never changed. Live Dia showed the current Connections screen, then remained on Loading workspace after reload. Changed UI is not deployed.

Full suite:530tests/90files passed. Typecheck and production build passed after the readability changes. No new paid request, cloud session, schedule activation or release action.

## Reference versioning and SEO/AEO navigation

The reference library now contains24 validated unique observed-post records (14 AI,10 gameplay,4 lower-reach comparisons). `reference-library-desktop-local.png` and `reference-library-mobile-local.png` show the bounded selected examples, provenance/metrics labels and limitations in a local fixture. The legacy recorded79 is historical and explicitly not reference-informed. Browser checks14/14 passed, including no-spend context save, historical-score gating, lane counts, comparison labels, read failure/retry and mobile width.

`seo-navigation-local.png` shows the new direct SEO & AEO navigation with an explicitly controlled local cached-response fixture. Four browser checks passed: direct navigation to selected game, all four groups, unmeasured claims and mobile width. No public-audit POST was made by this test. The existing production Dog Chase Search & answers view was separately opened read-only in local Dia: dated October29 cached baseline and unmeasured search/AI-citation sections were present. Production health still reportedc8f7d40 at inspection; new UI is not claimed deployed by these screenshots.

Full suite535tests/91files passed after updating current-context synthetic review fixtures. Focused reference/SEO8tests passed after the relevance/navigation refinements. No new real Jev review, cloud video, scheduled run or game-source URL mutation occurred.


## Shared design-system redesign — local verification

The `redesign-*-local.png` images show the actual local app with isolated acceptance fixtures. The79score is a replay of the previously completed review and remains historical. No new Jev review, cloud video, production record or social post was created by these checks. The design-system image is explicitly sample data.

Verified23 browser checks cover source cancel, source fact text, stale-score gating, selected editor focus/placement, unsaved changes, failed read/retry,24references, mobile overflow/menu/Escape and public pages. Populated editor/settings and settled Actions were captured after their reads completed. Independent review found no concrete visible blocker in inspected images. The full535-test suite,2additional health-runtime checks and production build passed. Color-pair checks are documented in DESIGN-SYSTEM.md; this is not a full WCAG certification or a real cloud production proof.
