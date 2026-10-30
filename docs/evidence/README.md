# Content Studio browser evidence

These screenshots are from an isolated local development workspace. The displayed80/100 is an explicitly labelled browser-only mock response for UI verification, not a real Jev score or cloud generation result. Editing the script immediately hides the old score and disables generation. The mobile viewport/document widths were both390px.

- content-studio-script-score-fixture.png: script editor, rubric dimensions, mock score and disabled paid generation.
- content-studio-script-stale-mobile-fixture.png: edited script, stale-score notice and disabled generation on mobile.

Runtime source was tested at c3de5704d94d6d9750e8959f4658a3fc21aa9c50:518tests/89files, TypeScript and production build passed. This evidence-only commit does not change runtime source.
