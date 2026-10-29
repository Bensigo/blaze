# Blaze launch setup

Use the existing Blaze Netlify site and Google login. In Games, add the exact public game URL; Connections contains that game's public SDK key, endpoint and approved origins. Account settings holds private writing/research and OpenRouter Jev configuration. Public Search & answers checks work without either AI or Jev.

Source is held in the private [Bensigo/blaze](https://github.com/Bensigo/blaze) repository. Releases use the existing Netlify CLI workflow; GitHub-triggered Netlify builds are unconfigured.

## Gameplay evidence required from Forever

Claude owns Forever changes, including War Start and Dog Chase. Blaze does not establish that any specific game is integrated merely because its manifest imports. For each launch game:

1. Install the canonical Blaze SDK and exact public key/origin from Connections. Follow `/developers` and `/developers.md`; private keys never belong in game code.
2. Keep analytics off until consent. Emit real `round_start`, once-per-session `first_action`, actual `round_complete`, retries/progression/errors and observed exit. Visit/loaded follow the consented SDK lifecycle. Do not synthesize completion from page exit or count test/agent runs as audience activity.
3. Preserve tagged `utm_source` and `utm_campaign` through the landing-to-game navigation. Test the exact final game URL and consented session. Missing tags/referrers remain incomplete attribution.
4. Measured `active_play` comes from the SDK's foreground/recent trusted input timing. Elapsed time is a separate session span. Adapter instrumentation must follow actual game lifecycle; the Frame v1 bridge does not carry every direct-SDK semantic event.
5. Gameplay recording requires the supported state/action adapter, a running isolated worker and configured OpenRouter Jev. Private recording/capture and player consent are separate from analytics. No worker uptime or paid Jev inference is established by unit tests.

## Metrics used at launch

- Visits: human sessions with a visit event. The instrumentation table reports raw event presence with the total human-session denominator; the ordered funnel applies its own sequence rules.
- Meaningful play: a visit-bearing session with a round start, followed by a round completion or at least 30 measured active seconds. This is an operational threshold, not proof of enjoyment.
- Exits: sessions reporting exit. Missing completion or exit means the final outcome was not observed.
- Active-play coverage: sessions supplying active measurement / eligible play sessions. Missing active time is unknown, not zero.
- D1: a visit in a different session at least 24 and less than 48 hours after the first observed human event. Only cohorts at least 48 hours old are eligible.
- Returning browser IDs: a different session at least 24 hours after that ID's first observed event in the selected window. It is broader than D1 and may cross campaigns.
- Source/campaign views describe observed tagged/referrer traffic. Existing Direct values include missing/invalid referrers. They do not establish full attribution, unique people or causal uplift.

## Discovery review

Choose Search & answers on a game card. Cached public research observations can appear while Game profile is queued or incomplete. Refresh review performs only public deterministic checks and does not queue gameplay or inference. Each group shows source evidence and observation time. A changed registered URL marks old evidence stale.

Page title, description, canonical and heading checks establish static presence only. Rules/controls/FAQ wording is a readiness hint with explicit semantic limits. Robots/sitemap HTTP success does not prove indexing. Search Console is unmeasured until its existing integration is configured and authorized research runs; AI citation tracking is not implemented. Keyword ideas without search evidence have no measured demand.

## Provider setup and proof limits

For drafts/research, choose Anthropic or OpenRouter, load models, choose a compatible model and save. For gameplay, select an OpenRouter key explicitly and Jev 1.13 or 1.14. Saving checks key access and decision endpoint metadata without inference; it does not establish credits or gameplay quality. The worker uses OpenRouter's [System One contract](https://openrouter.ai/docs/guides/community/typesafe-sdk), validates allowed action and resolved model version, and rejects stale queued selections. Do not reuse the old TypeSafe key assumption.

Provider/worker tests use fake credentials and mocked inference. Controlled browser/SDK journeys belong to isolated labelled workspaces. Hosted checks, physical devices, real audience retention, actual paid Jev decisions and always-on worker operation require separate evidence. No new service, paid upgrade, secret creation, social publication or Forever change is included in the Blaze release.
