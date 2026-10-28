# Browser telemetry SDK

Load `/sdk.js` from your deployment on a game origin registered for the game. Do not enable telemetry until the player has opted in:

```html
<script src="https://YOUR-APP/sdk.js"></script>
<script>
  GameMarketing.init({ endpoint: "https://YOUR-APP", sdkKey: "YOUR_GAME_KEY" });
  // Call after an affirmative consent choice:
  GameMarketing.setConsent(true);
  GameMarketing.track("first_action"); // At the first meaningful game action
  GameMarketing.track("round_start");
  GameMarketing.track("progression", { step: "level 2" });
  GameMarketing.track("round_complete", { result: "win" });
  // On withdrawal: GameMarketing.disable();
</script>
```

The SDK emits visit, loaded, exit and sampled pointer-down coordinates automatically. Instrument first_action at a meaningful game action; generic pointer and keyboard interactions do not count as meaningful play. Instrument round_start, round_complete, retry, progression and error in the game. Pointer coordinates are normalized viewport locations, not replay or semantic game data. The SDK strips URL query strings and fragments, except explicitly selected `utm_campaign` and `utm_source` attribution values; do not put personal or secret information in those values, URL paths, or event properties. It collects no input text or DOM. Only documented properties are accepted: step, level, result, code, x, y, duration. Free-form error messages are not sent; use a stable error code. Avoid personal data in them. Session and player IDs are pseudonymous, stored in sessionStorage and localStorage only after consent. After 30 minutes without an event, the next event starts a new session and emits visit and loaded again; first_action can be recorded once per session. Disabling stops future events; the host application owns its consent and deletion workflow. Browsers may drop keepalive events on exit. Public requests cannot mark themselves synthetic.

## Play adapter

To record agent play, expose `window.gameMarketingAdapter` with `getState()`, `actions` (current array of `{id,label}`), and `act(id)`. State must contain only data suitable for sending to the model, without credentials or player data. Actions must be bounded gameplay operations; never expose purchases, messages, navigation, or account changes. The controlled `/fixture/` game is a runnable example. Fixture mode uses a deterministic policy and is not evidence of Jev validation.

## Optional human canvas recording

Recording is off unless the game owner enables it and reviews the capture surface. The owner must configure one unique canvas selector and up to eight normalized mask rectangles (`x`, `y`, `width`, `height` between 0 and 1). Configure masks around every private region that can appear inside the canvas. The SDK copies only that canvas, paints masks black and records the copy; page inputs, chat, other DOM and audio are excluded. Canvas content must be origin-clean. A canvas can itself contain sensitive information, so do not enable recording until its contents and masks have been reviewed.

Ask for **separate affirmative recording consent** after analytics consent. Analytics consent alone never starts recording. Call only from a human player’s explicit choice, never from the agent play adapter:

```js
const state = await GameMarketing.startCapture({ consent: true });
// Show state.status to the player (recording, not_sampled, quota_reached,
// unsupported, failed, or another documented state).
await GameMarketing.stopCapture(); // Stop and save.
await GameMarketing.stopCapture({ discard: true }); // Withdraw and discard.
// GameMarketing.disable() or setConsent(false) also discards the current capture.
```

`GameMarketing.getCaptureState()` and `gm:capturestatus` events expose status, a stable failure reason where applicable, and a capture ID where available, never the grant token. Recording is sampled; a player can consent and still be `not_sampled` or encounter `quota_reached`. The server also requires a persisted human visit. Capture is capped at 5 frames per second, 960×540, 400 kbps, 30 seconds and 3 MiB. A supported WebM or MP4 MediaRecorder codec is required. Failures such as unsupported APIs, a tainted canvas, an invalid selector or upload failure are reported explicitly. Grant and upload requests omit cookies and are scoped to the configured game origin. Browser and network failures can prevent cancellation; tell users that application-level deletion remains available to the owner.

The fixture has separate tracking and recording controls and is intended only for controlled acceptance, not production player consent.

The studio worker reserves `window.__WEB_GAME_STUDIO_AGENT__ === true` for its automated game sessions. The worker injects an immutable marker before game code runs; when present, this SDK sends no human analytics, creates no analytics IDs in browser storage, and returns `agent_session` from `startCapture` without requesting a grant. This covers the studio's own automation; the marker is not general bot detection or a fraud-prevention boundary.

A recording stops and attempts to save as soon as its page becomes hidden, avoiding extended background recording when browsers throttle timers. An in-progress capture is discarded on page exit; an unload can interrupt that cancellation request, so the server expires unused grants. A page hidden before recording starts is cancelled.
