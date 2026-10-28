# Blaze SDK quickstart

This guide instruments a web game using the public browser SDK. It does not make the game playable by the recording agent, configure canvas capture, or change a sandboxed iframe. For the complete contract, see [SDK v1](./v1.md).

## Starting instruction for a developer or coding agent

Copy the instruction below and replace the three placeholders with the values from your registered game and dashboard. The game must be served on the registered origin. Share only the public SDK key, never server credentials.

```text
Instrument my web game on GAME_ORIGIN with Blaze using BLAZE_ORIGIN and PUBLIC_SDK_KEY. Read BLAZE_ORIGIN/docs/sdk/quickstart.md and BLAZE_ORIGIN/docs/sdk/v1.md, implement an explicit analytics consent choice and the documented lifecycle and semantic game events, then verify the documented counts and duplicate-delivery behavior on GAME_ORIGIN. Do not send personal data or enable recording without separate consent.
```

## 1. Register your game

In Blaze, add the game and register the exact browser origin serving the game, including scheme and port (for example, `http://localhost:3001`). Copy the **public SDK key** and Blaze app origin from the dashboard's install snippet. The game ID identifies the game in the dashboard; `Blaze.init` uses the SDK key, not the game ID. Never put provider credentials, account tokens, or server secrets in a game page. A public SDK key identifies a game and is not a secret; origin checks are not authentication against a malicious visitor.

Replace `BLAZE_ORIGIN` and `PUBLIC_SDK_KEY` below with the values in the install snippet. The script URL and `endpoint` must use the same Blaze app origin. Run your game from its registered HTTP(S) origin, not a `file:` URL.

```html
<script src="https://BLAZE_ORIGIN/sdk.js"></script>
<script>
  Blaze.init({ endpoint: "https://BLAZE_ORIGIN", sdkKey: "PUBLIC_SDK_KEY" });
  // Call only after the player affirmatively agrees to analytics:
  function allowAnalytics() { Blaze.setConsent(true); }
  // Wire this to your game's actual start action:
  function startRound() {
    Blaze.track("ui_click", { key: "start_button" });
    Blaze.track("round_start");
  }
  // Wire this to the first meaningful gameplay action, not page navigation:
  function movePlayer() {
    Blaze.track("first_action");
    Blaze.track("player_action", { key: "move_left" });
  }
  // Wire this to your game's completion logic:
  function finishRound() {
    Blaze.track("milestone", { key: "level_1", value: 1 });
    Blaze.track("round_complete", { result: "win" });
  }
  // Wire this to the player's withdrawal control:
  function withdrawAnalytics() { Blaze.disable(); }
</script>
```

These functions are examples: connect them to real consent and game handlers. The SDK does not infer gameplay actions from generic clicks. Use stable, developer-defined keys, never player names, email, chat, text input, URLs, or account identifiers.

## 2. Check the result

Open a fresh browser session on the registered game origin. Before opting in, check the browser Network panel: there should be no `/api/collect` requests or Blaze IDs in storage. After opt-in, a loaded page sends one `visit` and one `loaded`. Start once, perform one meaningful move, and finish once. In addition to those two automatic events, expect one each of `ui_click`, `round_start`, `first_action`, `player_action`, `milestone`, and `round_complete`, plus an `active_play` coverage marker. Pointer samples and positive active-play increments may also appear depending on real input and timing; they are not fixed counts. Repeat `first_action` in the same session and it should not send again.

Inspect `/api/collect` responses and the game's Sessions view. A successful response contains `accepted`; a duplicate or filtered event may yield zero. Origin mismatch or unknown key returns 403. Network failure, storage restrictions, browser shutdown, or a paused service can prevent events from appearing. The SDK does not expose a delivery receipt or retry failed requests. A successful local test is not proof that a deployment is available or that real players have consented.

To verify server deduplication, use a controlled, consented test session on the registered game origin. In browser DevTools Network, select a successful `/api/collect` request whose response was `{ "accepted": 1 }`, choose “Copy as fetch”, and run the copied fetch once in that same page's console. Preserve its original body and event ID. The replay should return `{ "accepted": 0 }` and should not add a second event to Sessions. The original event is already stored, so this is one repeat of the original request, not a new `Blaze.track` call. This manual check does not add an SDK retry or flush method; an actual failed request is not automatically retried. Only replay your own controlled test request and avoid exposing its body publicly.

For a sandboxed game, the trusted parent owns the SDK; use the reviewed [Frame v1 contract](./frame-v1.md), not direct calls across an opaque origin. The public v1 reference describes the bridge boundary.
