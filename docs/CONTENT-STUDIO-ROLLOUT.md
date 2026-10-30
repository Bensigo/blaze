# Concrete readiness and rollout bundle — pending approval

Verified 30 October2026. No provider request, cloud environment, scheduler activation, production write or release was performed in this preparation.

## Public WHOT inspection

Production Blaze has WHOT `game_c4d3ce8486ed4de1af3f54d087074fac`, registered at `https://forever.138-68-247-33.sslip.io/games/whot`. The public browser redirected to `https://forever.africa/games/whot`. Play now opened `https://forever.africa/whot.html` inside its iframe. The visible page explicitly said **Guest round**, **One free round against the computer**, and results/rewards are not saved. The actual rendered 3D table, cards and computer appeared; console identified Babylon.js9.31/WebGL2. This proves local guest entry/rendering, not cloud performance or recording. One attempted market click failed because its turn-dependent reference expired; no successful deliberate game action is claimed.

All observed HTTP resources in the parent and game iframe used `https://forever.africa`; the original redirect also used `https://forever.138-68-247-33.sslip.io`. No WebSocket requests were observed during this guest inspection. The three console errors were blocked favicon requests under the game's own CSP; the table still rendered. No login, real-player interaction, consent bypass, game source change or provider call occurred. The isolated browser was closed. Evidence: `output/playwright/whot-guest-round.png` and `whot-guest-snapshot.txt`.

## Proposed environment (create only after separate approval)

Name: **Blaze WHOT guest capture**. Anthropic cloud environment, no credentials, MCP, package downloads or extra packages. Limited networking with exact bare hosts:

- `forever.138-68-247-33.sslip.io`
- `forever.africa`

No wildcards, Neon storage host, social service or provider API host in the sandbox allowlist. The documented host allowlist permits writes as well as reads and does not provide a separate WebSocket-protocol prohibition; do not call it a read-only firewall. The agent is limited to the approved public guest workflow. The game already sends guest/engagement requests. Stop on any new required destination rather than broadening the list automatically.

Proposed create body, to validate against the current API before submission:

```json
{
  "name": "Blaze WHOT guest capture",
  "description": "One approved WHOT guest-versus-computer capture; no credentials or third-party uploads.",
  "config": {
    "type": "cloud",
    "networking": {
      "type": "limited",
      "allowed_hosts": ["forever.138-68-247-33.sslip.io", "forever.africa"],
      "allow_package_managers": false,
      "allow_mcp_servers": false
    }
  }
}
```

Use the standard documented Ubuntu24.04 x86_64 sandbox with installed Chromium/Playwright/ffmpeg. Documentation describes up to8GB RAM/10GB disk; no custom allocation or GPU/audio/FPS guarantee is selected. No environment exists yet, so its future ID is necessarily unavailable. Creating it is separate from starting a billable session. Reference: https://platform.claude.com/docs/en/api/beta/environments/create .

The saved game currently has empty resource/WebSocket origin arrays. The specific proposed reviewed game policy adds `https://forever.africa` to resource origins, retains the registered redirect target, and keeps WebSocket origins empty because none were observed. This policy update changes the source revision and requires fresh ideas/approval. Host policy alone cannot prohibit same-host WebSockets. Do not silently mark this or any other game as verified.

## Exact provider configuration schema

Workspace **`ws_a0b06c25f7f140f3ae91bc3bdefea6b6`**, record kind **`content_provider`**, record ID **`default`**. No such provider record currently exists. Exact TypeScript fields:

```typescript
{
  id: "default";
  connectionId: string;
  agentId: string;
  agentVersion: number;
  environmentId: string;
  revision: string;
  pilotVerified: boolean;
  networkPolicyVerified: boolean;
  organizationVerified: boolean;
  watchdogVerified: boolean;
  reviewedGames?: Record<string, {
    sourceRevision: string;
    gameAudioVerified: boolean;
  }>;
}
```

Known values: connectionId **`conn_44103cb09fb44569963f9df7126da8c2`**, agentId **`agent_01BmpBeh1nD4WkrmJqPNSXMy`**, agentVersion **1**. Organization identity was separately verified as `37d434cc-361f-45b7-84a7-725c0d45484c`. Use a fresh config revision when binding the approved environment. Bind reviewedGames only to the freshly calculated sourceRevision of WHOT after its policy review; gameAudioVerified remains false. Set verification flags only from actual evidence. No stored credential is created, copied or reconfigured by this proposal.

**First-pilot admission gap:** normal `approveVideo` and `startApprovedVideo` require studio readiness, including pilotVerified and this game's reviewed sourceRevision. Therefore the current ordinary UI cannot admit the first pilot. No dedicated bootstrap-pilot admission path is implemented. Do not set pilotVerified=true prematurely or bypass these checks. A separately reviewed operator pilot path with durable one-attempt approval, watchdog tracking and result import is needed before an end-to-end first pilot can run through Blaze. A Console-only capture test would not by itself prove Blaze approval/import/calendar integration.

## Exact storage destination

Allowlisted read-only local configuration inspection found the existing AWS-compatible settings:

- Endpoint: **`https://br-ancient-mud-b9rxvc5t.storage.c-7.eu-central-1.aws.neon.tech`**
- Region: **`eu-central-1`**
- Bucket: **`blaze-media`**

These are existing local deployment configuration values, not a fresh remote-storage/production-env validation. No object was uploaded, fetched or deleted. Existing server-side credentials remain undisclosed and are never sent to the sandbox. Anthropic Files downloads and storage writes happen only in Blaze's backend. Preview/download remains authenticated through Blaze.

## Native Netlify watchdog adapter

Existing production setup is `netlify.toml`, `npm run build`, `.next`, `@netlify/plugin-nextjs`; existing scheduled `blaze-daily.mts` runs `0 6 * * *` UTC and delegates to its background consumer. It is not the new content-idea agent and was not changed or activated here.

Prepared new function: **`netlify/paused-functions/blaze-content-watchdog.mts`**, deliberately **outside** Netlify's deployed `netlify/functions` directory. Its native cron is `* * * * *`. Its dispatch library is `src/lib/content-watchdog-dispatch.ts`. A normal feature release cannot register this new minute schedule while it remains in the paused directory.

After separate schedule approval, move the prepared file to `netlify/functions/blaze-content-watchdog.mts`, deploy, and set these server Functions-scope values using existing secret configuration:

```text
BLAZE_CLOUD_WATCHDOG_SCHEDULE_ENABLED=true
BLAZE_CLOUD_WATCHDOG_ENABLED=true
BLAZE_CLOUD_WATCHDOG_WORKSPACE_ID=ws_a0b06c25f7f140f3ae91bc3bdefea6b6
CONTEXT=production                      # Netlify supplies this
URL=https://blaze-bensigo.netlify.app    # Netlify production site URL
CRON_SECRET=<existing server-side value; do not reveal or replace>
```

The adapter rejects non-production contexts, absent settings, altered origins/path/query/credentials and redirects. It ignores DEPLOY_PRIME_URL. Exactly one authenticated POST goes to `https://blaze-bensigo.netlify.app/api/cron/content-production-watchdog` with body `{"workspaceId":"ws_a0b06c25f7f140f3ae91bc3bdefea6b6"}`. No request retry. Fetch timeout25s stays below Netlify's documented30s scheduled-function limit; the target route has its own60s limit. A timed-out caller is not evidence that the target stopped. Durable reservations and stale heartbeat guards handle uncertainty; no exact stop timing is promised.

Before a paid attempt, test production heartbeat, duplicate tick, stale-monitor blocking and restart behavior without sessions. Keep the watchdog running independently for the entire active/uncertain session lifetime. Do not auto-disable after a browser closes or a target time elapses. Disable the schedule only after provider idle/terminated is confirmed and no unresolved work remains. Disabling a handler flag still leaves native cron invocations if the function is registered; remove/pause the native schedule as a separate controlled action to end those costs. There is no automatic native-schedule teardown feature.

Netlify Scheduled Functions support all plans and run on published production deployments. They do not run automatically on deploy previews. No new scheduler account or credential is needed. Reference: https://docs.netlify.com/build/functions/scheduled-functions/ .

## Cost and availability limits

The actual Netlify plan/current allowance is **unverified**. The attempted existing Dia accessibility read was denied by automatic review because unknown private tabs could expose credentials. It was not retried or bypassed. No billing change or upgrade was attempted. A non-secret Netlify plan/usage page still needs scoped authorized inspection before activation.

Parent-verified current credit-plan pricing is10credits/GB-hour compute,2credits/10k requests and15credits/production deploy, with300/month on Free; legacy plans can differ. A30-day minute schedule yields43,200 ticks plus up to43,200 route requests. At those request rates,43,200 HTTP route requests alone correspond to8.64credits; counting ticks as requests as well would make17.28credits. Actual billing treatment, memory, duration, existing consumption and applicable plan must be verified. No claim of zero scheduler/deployment/storage cost is made. Reference: https://docs.netlify.com/manage/accounts-and-billing/billing/billing-for-credit-based-plans/how-credits-work/ .

Netlify outage, function failure, account pause or exhausted allowance can halt monitoring. A stale heartbeat blocks new starts but cannot guarantee stopping a cloud session already running. The pilot still needs operator observation and confirmed interruption; the provider budget remains the independent monetary threshold, with overshoot limitations.

Previously observed Anthropic billing had promotional credits, purchased balance0 and no payment methods. This is a historical observation, not a newly verified promo-only spending guarantee. Credit exhaustion must not be assumed to stop service automatically; purchased/auto-reload/invoiced funding, if applicable, needs non-secret billing verification before execution. No billing changes are approved.

## Remaining decisions, in order

1. Release the tested Content Studio slice with all new generation/daily/watchdog flags OFF and native minute function still outside deployed functions. No paid pilot is implied. Publication approval remains pending unless parent provides new evidence.
2. Approve the exact two-host restricted environment and WHOT game-network metadata update, with no new credentials or session.
3. Review/implement the bounded initial-pilot admission path; no flag falsification. This is implementation work, not permission to spend.
4. Inspect actual non-secret Netlify allowance/billing, then approve the native minute schedule and existing-server-secret use only for this workspace; validate its no-spend operation.
5. Approve the separately specified single gameplay pilot only after admission/monitoring are ready. Proposed $1 is a list-cost threshold, **not a hard spending cap**. No enforceable upper total cost has been established. No retries or purchased-credit/billing expansion.
6. Activate daily metered ideas later only with the selected Dubai time, account/budget and fresh recurring authorization. Defaults remain off.
