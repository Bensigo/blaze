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
