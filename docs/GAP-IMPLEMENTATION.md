# Authorized follow-up — 28 October 2026

Implement per-game public resource/WebSocket permissions and consented real-player canvas recordings, preserving approval/isolation/synthetic safeguards. The product remains Next.js 16 App Router. The user rejected the original dashboard and selected a light workspace with cleaner typography, fewer boxes and more whitespace; redesign the composition around that choice. No branding/billing/native-game expansion.

## Shared contracts and file ownership

Main owns types, actions, DB, media, capture routes/service, workspace/session API integration, release evidence and deployment. Network agent owns worker network/safety code + its tests/controlled fixture. SDK agent owns sdk/sdk.js, public/sdk.js, public/fixture capture controls, docs/SDK.md and SDK tests. UI agent owns components/dashboard, globals.css, docs/UI.md, demo as necessary.

`Game.networkPolicy={resourceOrigins:string[],webSocketOrigins:string[]}` stores explicit origins only. Same-origin HTTPS resources work by default. Production destinations must resolve to verified public IPs pinned in Chromium; credentials/private/local addresses, wildcards and unknown origins remain blocked, including redirects and socket handshakes. Saving origins validates them; each run resolves/validates again. WebSockets are opt-in per origin, including same-host sockets.

`Game.capture` type is in types.ts. Off by default. Enable only with a unique canvas selector, surfaceReviewed confirmation, explicit player recording consent, and analytics consent. Default 10% deterministic sampling, 30 seconds, 1-day retention, 25 captures/day per game, up to 8 normalized mask rectangles. Fixed hard limits: 5fps, 960×540 maximum output, 400kbps video, 3MiB upload, no audio or DOM capture. Canvas drawing must be origin-clean. Black masks cover configured private canvas regions; HTML inputs/chat are outside the captured surface by design.

SDK starts only via `await Blaze.startCapture({consent:true})`; stop via `await Blaze.stopCapture()`; discard/revoke via `await Blaze.stopCapture({discard:true})` and analytics withdrawal also discards active/current capture. No automatic recording after ordinary analytics consent. Status available via `Blaze.getCaptureState()` and `blaze:capturestatus` event (no secret token in public event payload).

Public origin-scoped endpoints, all fail closed:
- POST `/api/capture/start` JSON `{sdkKey,sessionId,consent:true}`. Requires an existing server-stored human visit. Returns `{status:'pending',captureId,token,config:{...ownerConfig,fps:5,maxWidth:960,maxHeight:540,maxBytes:3145728,videoBitsPerSecond:400000},uploadUrl:'/api/capture/upload'}` or explicit not_sampled/quota status. One capture grant per game/session; token is short-lived and scoped, not the worker token.
- POST `/api/capture/upload` multipart `{captureId,token,file,durationSeconds,width,height,recordedAt}`. The SDK sends actual recorder start; the server validates it against grant/current time. Legacy uploads may omit it and have approximate timeline alignment. Max3MiB. Atomic one-use grant, configured origin, game still enabled, inspected silent video metadata. Stores private media, returns `{status:'ready',captureId}`. Does not create agent events or generic recordings.
- POST `/api/capture/status` JSON `{captureId,token,status:'unsupported'|'failed',reason:stable_code}` records unsupported/failed state. No arbitrary error/input text.
- POST `/api/capture/cancel` JSON `{captureId,token}` revokes the current grant and deletes its ready/private media if present.
- OPTIONS supports configured SDK game origins, scoped CORS, no credential cookies.

GET `/api/sessions/:id?gameId=...` returns `{session,events,capture?:SessionCapture}` after owner authentication, with capture video at `/api/media/:id`. Session rows include captureStatus/captureId in snapshot. Owner action `delete_session_capture {id}` is workspace scoped. Authenticated playback and byte ranges use existing private media routes; no signed public sharing of human captures. Cron expires capture media and marks abandoned grants; supported failures stay visible. Real-player capture never changes event kind or enters synthetic analytics.

## Acceptance

Real browser: recording-disabled and consent-denied send no footage; explicit consent + configured canvas produces playable private evidence; DOM/chat inputs are excluded and masks applied; withdrawal discards; oversized/expired/foreign/agent grants rejected; correct owner can play from Sessions and foreign/anonymous access fails. Browser network fixture must depend on an additional allowed public origin and WSS, show success with explicit policy and failure when omitted; private/unapproved redirects and socket destinations rejected. Test-only local transport/resolver wiring must not become a production private-origin bypass.
