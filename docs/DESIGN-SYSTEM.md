# Blaze design system

Visual thesis: a focused, neutral workspace with strong text contrast, quiet dividers and a single green action accent. Linear's public product presentation informs restraint and hierarchy; Mobbin's publicly available preview informs reference research only. No gated screens or proprietary assets are copied.

Content hierarchy: workspace navigation, page purpose and one next action, operational data, then optional provenance and advanced settings. Product status and limits must remain truthful.

Interaction thesis: quick navigation feedback, a focused selected-idea inspector, and deliberate loading/error recovery. Respect reduced motion. Never use motion to imply work has completed.

Foundations: system sans; 12px metadata, 14px controls/table text, 15px body, 16px section headings, 28–32px page titles. Use 4/8/12/16/24/32/48px spacing. Corners 6px controls, 8–10px panels. Text #202126, secondary #62656e, border #e5e6ea, white canvas, #f7f7f8 navigation, #32684f accent. Status uses text plus color. Primary text and controls target WCAG AA contrast; mobile targets 44px, desktop controls minimum38px.

Working preview: `/design-system`. All rows are explicitly sample data. Its interactions do not save records or call AI providers.


## Reference access

- Linear: visually inspected the public features presentation. The official refresh article documents consistent controls, quieter navigation and neutralized surfaces: https://linear.app/now/behind-the-latest-design-refresh .
- Mobbin: read the public dashboard pattern index at https://mobbin.com/explore/web/screens/dashboard . The screenshot gallery required login/returned403. Individual Mobbin dashboard screenshots were not visually inspected. No paid access or copied assets.

## Verification boundaries

Shared tokens are applied across the shell, analytics, games, content/editor, calendar, actions, settings, connections, discovery, public landing and developer guide. Supplemental explanations use the existing accessible InfoHint pattern; spend, stale scores, destructive consequences and errors remain visible. Overview keeps totals/activity/recent sessions; detailed measures remain available in Player analytics. Date filters appear only where they change results.

Color checks: primary text/white16.07:1; secondary text/white5.82:1; secondary/sidebar5.44:1; white/primary-action6.50:1; input boundary/white3.20:1. These are token-pair checks, not a claim of a full WCAG audit.

Local fixtures replay the existing historical79score; no new AI review or video is generated during verification. A real cloud gameplay/capture/edit/storage/dashboard pilot remains unproven and separately gated.


Final local checks:535tests in91files passed;2additional health readback tests passed;23browser checks passed, with extra settled Actions captures. Production build/typecheck passed. Independent source and visual review found no concrete blockers in inspected scope. Public health now exposes only non-secret booleans for the seven runtime gates, enabling post-release verification without inspecting credentials.
