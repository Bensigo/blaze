# Blaze design system

Visual thesis: a focused, neutral workspace with strong text contrast, quiet dividers and a single green action accent. Linear's public product presentation informs restraint and hierarchy; Mobbin's publicly available preview informs reference research only. No gated screens or proprietary assets are copied.

Content hierarchy: workspace navigation, page purpose and one next action, operational data, then optional provenance and advanced settings. Product status and limits must remain truthful.

Interaction thesis: quick navigation feedback, a focused session inspector, and deliberate loading/error recovery. Respect reduced motion. Never use motion to imply work has completed.

Foundations: system sans; 12px metadata, 14px controls/table text, 15px body, 16px section headings, 28–32px page titles. Use 4/8/12/16/24/32/48px spacing. Corners 6px controls, 8–10px panels. Text #202126, secondary #62656e, border #e5e6ea, white canvas, #f7f7f8 navigation, #32684f accent. Status uses text plus color. Primary text and controls target WCAG AA contrast; mobile targets 44px, desktop controls minimum38px.

Working preview: `/design-system`. All rows are explicitly sample data. Its interactions do not save records or contact external services.


## Reference access

- Linear: visually inspected the public features presentation. The official refresh article documents consistent controls, quieter navigation and neutralized surfaces: https://linear.app/now/behind-the-latest-design-refresh .
- Mobbin: read the public dashboard pattern index at https://mobbin.com/explore/web/screens/dashboard . The screenshot gallery required login/returned403. Individual Mobbin dashboard screenshots were not visually inspected. No paid access or copied assets.

## Verification boundaries

Shared tokens apply to analytics, games, sessions, findings, settings, connections, discovery, the public landing and developer guide. Explanations use the accessible InfoHint pattern; failures and unavailable evidence remain visible. Date filters appear only where they change results.

Color token pairs previously checked include primary text/white 16.07:1, secondary text/white 5.82:1 and white/primary action 6.50:1. These token checks do not establish a full accessibility audit. Recheck changed controls and wide/narrow layouts for every release; historical test totals are not current verification.
