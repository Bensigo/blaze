# Dog Chase first cloud pilot — not authorized or executed

WHOT is superseded. User-selected target is **DOG CHASE**, game `game_daf42f7a85dd4d4e804b832f39d75056`. Required flow is script draft/user edits → Jev score → owner approves exact script/settings → one cloud gameplay video → private Blaze storage/dashboard preview/download → optional Dubai planning date/manual posting.

## Proposed script for review, not a Jev-scored result

20 seconds, portrait9:16, minimal captions, restrained motion graphics, quiet generated music, native game audio off.

- 0–3s: “Can you outrun the dogs in Agege?” Show actual guest entry/runner.
- 3–8s: “Swipe or use the arrow keys.” Show actual movement.
- 8–14s: “Jump. Slide. Pick your road.” Show only successfully captured documented inputs/results.
- 14–18s: “Collect puff-puff on the run.” Use only if that collection is actually captured; otherwise show the real obstacle/result without this claim.
- 18–20s: “Play Dog Chase.” Hold on an actual game frame with the title. Do not imply an escape or win unless captured.

This draft uses the public game page's facts. It must be saved as an editable script artifact against the current source revision before Jev review. No default/fabricated score exists. If edited after review, the score and any unstarted video approval become stale.

## Stage A: one Jev critique

Use existing saved OpenRouter Jev selection, pinned revision/credential fingerprint, model `typesafe/jev-1.14` as currently selected; no Anthropic-credit claim. Official Jev API is **POST https://openrouter.ai/api/alpha/decisions**, not Chat Completions. It returns typed decisions, not free-form explanations. One request asks four Score questions (hook/pacing/clarity/shareability) plus an unsupported-claim check. Each0–4 weighted rating is scaled/rounded to0–25; their sum is the visible0–100 score. Explanations and suggested improvements come from the displayed rubric and are labelled accordingly. This is not a probability or guarantee of virality.

Full serialized request limited to16KiB UTF-8, exactly five typed text-only questions, pinned Jev1.14/TypeSafe, no images/assets/long-context headers, no retry/fallback. A fresh local approval reserves exactly$0.01. Routing price ceilings remain$0.042/M input and free output. Short text stays in default mode: documented combined context ceiling is64k tokens for state plus ALL questions; provider rejects context overflow. Conservatively65,536×$0.042/M = **$0.002752512**, below the approved$0.01. This is a documented admission bound, not an API per-call dollar cutoff. Policy version/budget/bound are in the approval hash and rechecked before sending the identical serialized body. Usage fields are checked independently; missing/malformed usage or a reported token/price/cost-bound violation rejects the score and holds further workspace reviews pending reconciliation. The Decisions endpoint does not expose the Chat API's max_tokens parameter; no unsupported output-token cap is promised. Actual billed input tokens include the decision request's state/questions. Published price: https://openrouter.ai/typesafe/jev-1.14 . API: https://openrouter.ai/docs/guides/community/jev .

Approve only this saved script/review hash and one request. A lost response consumes the durable start and becomes needs_reconciliation, never automatic retry. A complete malformed/out-of-range response fails without a score. Starting/uncertain attempts block further reviews for that script. Edited/expired unstarted approvals can be consumed safely. The latest attempt is authoritative in both UI/backend; failed re-review cannot silently use an older score.

Show the real score before the owner decides whether to edit or approve video production. Editing means a new review approval and potential additional cost; it is not included automatically.

## Stage B: one cloud video after exact approval

Pin Anthropic producer `agent_01BmpBeh1nD4WkrmJqPNSXMy` v1, `claude-opus-5-5`, low effort, no subagents/workflows/fallbacks. Proposed session list-cost threshold **100cents ($1)**, one create, no retry/resume or increased threshold. Planning target50k input/8k output tokens: about $0.36 at last verified $4/$20 per million, plus about $0.013 for10min running time at $0.08/hour. These token counts are planning estimates, not cumulative enforced limits. Provider budget checks between requests and can overshoot. **No enforceable total dollar cap is established.** Existing promotional credits do not guarantee promo-only spending if other funding exists.

Target20s720×1280 H264/AAC MP4. Cloud agent must open the real registered URL, enter the offered free solo guest run, actively play, capture raw motion footage/action evidence, and edit the approved script. No supplied-footage/drawn substitute, login, purchase, additional guest-limit bypass or real-player interaction. Stop on blocked play/consent/WebGL/network, missing required footage/audio or insufficient content. Never fabricate success. First attempt's native game audio is off; music does not prove captured game audio.

Registered URL `https://forever.138-68-247-33.sslip.io/games/dog-chase` redirects to `https://forever.africa/games/dog-chase`; iframe is `https://forever.africa/dog-chase.html`. Local inspection confirmed solo guest entry, Agege free-run control, documented arrows/swipe/jump/slide/road selection and same-origin resources. Optional consent was rejected. No real cloud play/capture has occurred. Preserve raw capture in session Files and inspect it manually; Blaze currently validates final media structure and scoped raw-file metadata, not raw-video authenticity.

## Single-use admission and watchdog

The first-pilot path now exists. Exact operator/workspace/game env bindings, separate default-off pilot switch, existing direct Anthropic key, restricted environment, verified organization/network policy and independently proven no-spend watchdog admission are required. Only previous pilot evidence/per-game audio/play verification and normal production enablement are waived. No normal verification flag is set. A15min grant binds complete source/idea/script/score/settings/provider/credential snapshots; consumed atomically with the starting record before one session request. Expiry, target changes, edits, key/provider changes, missing/stale monitor or unresolved earlier work block dispatch. Failed/uncertain runs never reset a grant.

The watchdog recognizes admitted pilots without claiming that a real deadline stop has already been proven. Its independent minute trigger must pass no-spend heartbeat/stale/restart checks first. Immutable30min interrupt threshold includes polling/tool completion delays; ten minutes is a target, not a guaranteed stop. Keep monitoring active until confirmed idle/terminated and no uncertain work. Netlify outages/account pause can defeat active-session monitoring; stale heartbeat alone cannot stop a running provider session.

## Dashboard acceptance and cleanup

Use existing workspace-bound refresh/import, authenticated preview/download and calendar paths for the pilot. Backend downloads only session-scoped Files, validates the final MP4 against settings, writes existing private Neon S3 storage and returns the real playable video to this owner's Blaze dashboard. Verify actual preview, download, cross-workspace denial and Dubai planning date; never mark end-to-end success based on mocks or Console-only output. Social posting stays manual.

150MB final-video and128KB evidence limits; prefer final under25MB/raw under100MB. Agent gets no storage credentials. Source facts/script/settings go to OpenRouter for the review and Anthropic for approved production; public game hosts go to the sandbox; final scoped Files go through Blaze backend to existing private storage. No social destination. Raw evidence remains in provider Files until explicit retention/cleanup decisions. On failure, preserve session/review identifiers and usage, interrupt once where possible, confirm stopped and stop work. No destructive cleanup, paid retry or replacement without fresh approval.

No live setup, recurring activation, billing change, release or paid execution has occurred. Exact rollout fields/destinations are in CONTENT-STUDIO-ROLLOUT.md.

## One-cent bound evidence

- https://openrouter.ai/docs/guides/community/jev#frequently-asked-questions — text above about32,000bytes or any image enters long context; shorter text uses default mode.16KiB full JSON remains well below that threshold and contains only fixed plain-text state/questions.
- https://docs.typesafe.ai/models#context-length — default64k combined state plus all questions;32k perquestion, shared state ingested once.65,536 is a conservative interpretation of64k, not a multiplication by five.
- https://docs.typesafe.ai/api/errors — over-context input rejected with max_tokens_exceeded.
- https://docs.typesafe.ai/api/system-one — usage.input_tokens counts billable input; output free.
- https://openrouter.ai/api/v1/providers — public metadata confirmed TypeSafe slug typesafe. Routing only=[typesafe], allow_fallbacks=false, max_price prompt=.042/completion=0.

Parent approval is still pending. Before execution verify sufficient existing OpenRouter balance without new funds; no paid call, top-up, environment, schedule or release was performed for this cost-preparation step. Anthropic video remains separately unapproved and retains its overshoot caveat.
