# Workspace UI

Visual thesis: a light, neutral game workspace with strong ink typography, generous working space, actual game art, and one restrained green accent.

Content plan: grouped navigation leads to player evidence and production. The overview pairs readable player metrics and a large activity chart with the selected game's real artwork and operating status, then recent sessions, findings, and the publishing queue. Empty, disconnected, fixture, and example states stay explicit.

Interaction thesis: navigation uses a quiet active indicator, controls respond with short color transitions, and the mobile navigation and session inspector slide into place. Reduced-motion preferences suppress these transitions.

Game settings expose exact public resource and WebSocket origins and a separately enabled, reviewed canvas capture configuration. The player must opt in to analytics and separately to recording. Sessions show capture status and private playback where available; events within the recording interval seek relative to the capture start. Captures remain distinct from agent recordings and clips. The example session's unsupported status is illustrative and has no footage.

Authenticated workspace data refreshes every five seconds while recording, clip or publishing work is in progress and every 30 seconds while idle. It also refreshes when the tab becomes visible or when the operator selects Refresh. The selected recording and clip inspectors follow updated job status; in-progress form edits are not replaced. The example workspace remains read-only.

## Local UI check — 28 October 2026

In Chromium at 1440 × 900, 1024 × 768, and 390 × 844, all 10 workspace navigation destinations opened. The example game filter updated the focus panel; its analytics and record actions opened the intended views, and the game editor showed both network fields and capture controls. The full fixture cover is visible. After constraining the overview/analytics grid columns, all 10 destinations fit the 390 px document viewport; calendar and wide tables scroll within their regions. No page exceptions were observed in this pass.

An authenticated local fixture capture loaded from the private media route and played for 0.52 seconds; manual video seeking worked. A second actual fixture capture included three in-window game events: clicking the pointer event sought to 0.579 seconds, matching the event timestamp relative to capture start. These emulated browser checks do not establish physical-device behavior.
