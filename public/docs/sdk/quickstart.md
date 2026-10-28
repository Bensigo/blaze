# Blaze SDK quickstart

This guide instruments a web game using the public browser SDK. It does not make the game playable by the recording agent, configure canvas capture, or change a sandboxed iframe. For the complete contract, see [SDK v1](https://blaze-bensigo.netlify.app/docs/sdk/v1.md).

## Starting instruction for a developer or coding agent

Copy this instruction, supply your game's origin and public SDK key from its dashboard install snippet, and give it to your developer or coding agent:

```text
Instrument my web game for Blaze. Read https://blaze-bensigo.netlify.app/docs/sdk/quickstart.md and https://blaze-bensigo.netlify.app/docs/sdk/v1.md. Use the game's exact registered GAME_ORIGIN and its PUBLIC_SDK_KEY from the Blaze dashboard install snippet. Implement an affirmative analytics consent choice and withdrawal, connect the documented lifecycle and semantic events to real game actions, and verify using an isolated, consented test session. Do not send personal data or enable recording without separate consent. If the game is sandboxed, also read https://blaze-bensigo.netlify.app/docs/sdk/frame-v1.md and preserve the sandbox.
```

## 1. Register your game

In Blaze, add the game by its public game URL. Blaze requests that URL with `/forever.json` appended, validates the manifest and imports its metadata; a missing or invalid manifest is an error. This import is separate from analytics and does not install the SDK or establish consent. Select the game in the dashboard, then open **Setup & help → Get started → Install the SDK**. The configuration lists its **Game ID**, **Public SDK key**, **SDK endpoint** and **Allowed origins**, followed by its install snippet. The Game ID identifies dashboard/API records; `Blaze.init` uses the public SDK key, not the Game ID.

Register the exact browser origin serving the game, including scheme and port (for example, `http://localhost:3001`). The game URL's origin is registered on import; use Edit game to update the origin list if gameplay runs elsewhere. Never put provider credentials, worker tokens, account tokens or server secrets in a game page. A public SDK key identifies a game and is not a secret; origin checks are not authentication against a malicious visitor. For a separately configured development/test Blaze instance, replace **both** the script URL origin and `endpoint` with that instance's origin and use its own test-game public key.

Replace `PUBLIC_SDK_KEY` below with the public key in the install snippet. The script URL and `endpoint` use the permanent Blaze origin. Run your game from its registered HTTP(S) origin, not a `file:` URL.

```html
<script src="https://blaze-bensigo.netlify.app/sdk.js"></script>
<script>
  Blaze.init({ endpoint: "https://blaze-bensigo.netlify.app", sdkKey: "PUBLIC_SDK_KEY", consent: false });
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

Open a fresh browser session on the registered game origin. Before opting in, check the browser Network panel: there should be no `/api/collect` requests or Blaze IDs in storage. After opt-in, a loaded page sends one `visit` and, when the page completes loading, one `loaded`. Start once, perform one meaningful move, and finish once. In addition to those two automatic events, expect one each of `ui_click`, `round_start`, `first_action`, `player_action`, `milestone`, and `round_complete`, plus an `active_play` zero-duration coverage marker. Viewport pointer samples and positive active-play increments may also appear depending on input, focus and timing; they are not fixed counts. The SDK does not infer semantic events from generic clicks. Repeat `first_action` in the same session and it should not send again.

Inspect `/api/collect` responses and the game's Sessions view. A successful response contains `accepted`; a duplicate or filtered event may yield zero. An origin mismatch or unknown key is rejected with 403 by the service; the browser may instead report a CORS or preflight failure and hide the response from JavaScript. Check DevTools Network and the registered key/origin. Network failure, storage restrictions, browser shutdown, or a paused service can prevent events from appearing. The SDK does not expose a delivery receipt or retry failed requests. A successful local test is not proof that a deployment is available or that real players have consented.

To verify server deduplication, use a controlled, consented test session on the registered game origin. In browser DevTools Network, select a successful `/api/collect` request whose response was `{ "accepted": 1 }`, choose “Copy as fetch”, and run the copied fetch once in that same page's console. Preserve its original body and event ID. The replay should return `{ "accepted": 0 }` and should not add a second event to Sessions. The original event is already stored, so this is one repeat of the original request, not a new `Blaze.track` call. This manual check does not add an SDK retry or flush method; an actual failed request is not automatically retried. Only replay your own controlled test request and avoid exposing its body publicly.

For a sandboxed game, the trusted parent owns the SDK; use the reviewed [Frame v1 contract](https://blaze-bensigo.netlify.app/docs/sdk/frame-v1.md), not direct calls across an opaque origin. The public v1 reference describes the bridge boundary.

## Troubleshooting

- A manifest import error concerns the game URL and its `/forever.json` response. Check that the public manifest exists, is valid version 1 and is served without redirects; do not substitute the Blaze game ID or SDK key for that URL.
- A 403 or CORS/preflight failure from `/api/collect` can mean the public key is unknown or the request Origin does not exactly match a registered game origin, including scheme and port. A rejected origin may fail OPTIONS before POST; JavaScript cannot always read the underlying response. Check DevTools Network, the dashboard install snippet and origin list.
- If no requests appear, confirm the game loaded the script, called `init`, and received affirmative consent. A content blocker, storage restriction, network failure, untrusted game origin, rate limit, or temporary ingestion pause can also interfere.
- A `200` with `accepted: 0` means no event was newly stored, for example because it was filtered or duplicated. Check event names, keys, timestamps and the Network response. Do not count a controlled test or fixture as audience activity.
