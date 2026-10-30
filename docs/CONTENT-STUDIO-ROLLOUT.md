# Dog Chase rollout bundle — pending approval

The user-selected live test is DOG CHASE. WHOT is superseded. No production writes, paid provider calls, environment/schedule activation or release occurred in this preparation.

## Fixed identities and source

- Workspace: `ws_a0b06c25f7f140f3ae91bc3bdefea6b6`
- Operator authenticated ID: `neon:3402f542-521f-4e7f-9667-14bbd6da6b9f`
- DOG CHASE: `game_daf42f7a85dd4d4e804b832f39d75056`
- Registered URL: `https://forever.138-68-247-33.sslip.io/games/dog-chase`
- Observed canonical redirect: `https://forever.africa/games/dog-chase`
- Observed iframe: `https://forever.africa/dog-chase.html`
- Anthropic connection: `conn_44103cb09fb44569963f9df7126da8c2`
- Anthropic organization: `37d434cc-361f-45b7-84a7-725c0d45484c`
- Producer: `agent_01BmpBeh1nD4WkrmJqPNSXMy`, version1, `claude-opus-5-5`, low effort
- Jev/OpenRouter connection: `conn_cfb35c6e75a94f86b07c9193cd517dcb`, model `typesafe/jev-1.14`, settings revision `rev_2ca3bad7af38493a9dbfc80aae9a0265`

A targeted READ ONLY query confirmed these owner/game/selection IDs, without key decryption, provider calls or writes. Revision/credential/source hashes are recalculated in the app at the exact review/approval and rechecked at dispatch; stale hashes cannot be reused.

Public isolated-browser inspection rejected optional consent, then opened the offered solo guest entry: Agege, Free guest run, arrow/swipe controls, jump/slide/road selection and no saved guest results. Parent and iframe resources observed were on forever.africa, with the original sslip host only for redirect. No WebSockets were observed in this inspection. No purchase, login, guest-limit bypass, real-user interaction, Forever change or real cloud capture occurred. Browser closed. Evidence: output/playwright/dog-chase-guest.png and dog-chase-guest.txt.

## Proposed restricted environment

Create **Blaze Dog Chase guest capture** only after explicit setup approval. Standard Anthropic cloud environment; exact two-host limited networking:

```json
{
  "name": "Blaze Dog Chase guest capture",
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

No extra packages, credentials, wildcards, provider API, storage or social hosts. Use installed Chromium/Playwright/ffmpeg. Documented standard sandbox is Ubuntu24.04 x86_64, up to8GB RAM/10GB disk; no custom resources/GPU/audio guarantee. Host allowlisting permits writes and cannot separately prohibit same-host WebSockets. Stop on any required new origin instead of auto-expanding access. No environment exists yet; use its returned ID only after approved creation. Source: https://platform.claude.com/docs/en/api/beta/environments/create .

Existing Dog Chase game network arrays are empty. Proposed reviewed metadata adds resource origin https://forever.africa and exact frame URL https://forever.africa/dog-chase.html, leaving WebSocket origins empty. This changes source revision; prepare fresh idea/script approvals afterward. No production game metadata was changed.

## Exact provider record

Kind `content_provider`, ID `default`, in the owner workspace. No current record exists.

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
  watchdogAdmissionVerified?: boolean;
  reviewedGames?: Record<string, {
    sourceRevision: string;
    gameAudioVerified: boolean;
  }>;
}
```

Bind the exact existing connection, created agent/version and separately approved environment. Use a fresh revision. Organization/network flags require actual reviewed evidence. `watchdogAdmissionVerified` is only the no-spend independent heartbeat/stale/restart validation; it is not evidence of a real cloud stop. Set it after that validation. `pilotVerified`, `watchdogVerified` and reviewed game/audio evidence stay false/unset until actually proven. The first-pilot path works without falsifying those flags; ordinary production remains gated.

## Script and single-use pilot admission

`/api/content-studio/scripts`: draft/edit saved script, inspect Jev request, approve one critique and start it once. No-spend source drafts are labelled; owner text is supported. Script edits immediately stale the displayed score, invalidate unstarted video approval, and consume only unstarted outdated critique grants. In-flight/uncertain reviews remain unretryable. Latest review attempt is authoritative in both client/backend. Malformed/out-of-range results never receive a default score.

Actual Jev integration uses https://openrouter.ai/api/alpha/decisions, five typed questions, one16KiB-bounded complete text-only request and128KB-bounded response. Four0–4 ratings become0–25 rubric dimensions summed to0–100. Rubric explanation/suggestion text is labelled; Jev does not generate prose or predict virality. Published input price is $0.042/M and output free; request routing sets those unit-price maxima and disables fallbacks. The explicit review budget is$0.01; documented default-mode65,536-token context at the routed$0.042/M ceiling gives a conservative$0.002752512 bound. It is not an API dollar cutoff. Missing/malformed usage or any observed policy violation holds further workspace reviews. Existing Jev gameplay grants are never reused. Anthropic credits do not cover this separate OpenRouter request. Source: https://openrouter.ai/docs/guides/community/jev and https://openrouter.ai/typesafe/jev-1.14 .

`/api/content-studio/pilot`: same-origin authenticated operator review → explicit single-use grant → separate start. Grant binds game/source/idea, exact script text/revision and successful latest Jev score, video settings, cost threshold, agent/version/environment, provider/config and credential revisions, owner/workspace, request ID and15min expiry. The configured game is checked at both review and dispatch. Grant consumption and starting record are one transaction, before one provider create. No resume/retry; uncertain create blocks new production. Repeated requests never renew/reset a grant. Normal generation/verification is not enabled. Existing scoped import/media/download/calendar paths accept the pilot output and expose it in the dashboard.

Server settings, only after the corresponding approvals:

```text
BLAZE_CLOUD_PILOT_OPERATOR_ID=neon:3402f542-521f-4e7f-9667-14bbd6da6b9f
BLAZE_CLOUD_PILOT_WORKSPACE_ID=ws_a0b06c25f7f140f3ae91bc3bdefea6b6
BLAZE_CLOUD_PILOT_GAME_ID=game_daf42f7a85dd4d4e804b832f39d75056
BLAZE_CLOUD_PILOT_MAX_LIST_COST_CENTS=100
BLAZE_JEV_SCRIPT_REVIEW_ENABLED=true   # only for the approved critique
BLAZE_CLOUD_PILOT_ENABLED=true        # only for the approved pilot
BLAZE_CLOUD_PRODUCTION_ENABLED=false
BLAZE_DAILY_IDEAS_ENABLED=false
```

All new metered flags default false. Enabling a flag does not create a session or grant. Jev cost acknowledgement and the exact later script/settings pilot approval remain separate deliberate steps. Display the actual score before approving video; edits require a fresh critique grant, not an included automatic retry.

## Native independent monitor

Prepared minute adapter is `netlify/paused-functions/blaze-content-watchdog.mts`, outside Netlify's deployed function directory. A feature-only release cannot register it. Existing native daily research function was not changed/activated and is not the new idea agent; do not restart old workers/recurrence during rollout.

After separate scheduler approval: move adapter into netlify/functions, deploy, configure Functions-scope existing CRON_SECRET without exposing/replacing it, and set:

```text
BLAZE_CLOUD_WATCHDOG_SCHEDULE_ENABLED=true
BLAZE_CLOUD_WATCHDOG_ENABLED=true
BLAZE_CLOUD_WATCHDOG_WORKSPACE_ID=ws_a0b06c25f7f140f3ae91bc3bdefea6b6
```

Netlify supplies production CONTEXT/URL. Adapter requires production, pins https://blaze-bensigo.netlify.app, rejects preview/redirection destinations, and sends one POST to /api/cron/content-production-watchdog with that exact workspace and existing bearer.25s request timeout; no retry. Native cron * * * * *; Netlify documents all-plan availability, production-only schedules and30s function limit. Route's independent60s limit is not proof that work completes after a caller timeout. Durable start/stop reservations and90s heartbeat guard handle uncertainty. Source: https://docs.netlify.com/build/functions/scheduled-functions/ .

Prove no-spend heartbeat/stale/restart/duplicate behavior before any paid pilot. Watchdog admits bounded pilots via watchdogAdmissionVerified without claiming previous gameplay/stop proof. Monitor must outlive browser/client and remain active until confirmed idle/terminated with no unresolved work. Immutable30min interrupt threshold includes polling/tool delays; ten minutes is only a target. Netlify outage/account pause can halt monitoring; a stale heartbeat prevents new starts but cannot guarantee stopping an already running cloud session.

Disable only after confirmed stop/reconciliation; false handler flag does not remove registered cron invocation costs. Native schedule removal/pause requires a controlled action. No automatic schedule teardown exists.

## Destinations, costs and remaining approvals

Existing private storage endpoint: https://br-ancient-mud-b9rxvc5t.storage.c-7.eu-central-1.aws.neon.tech ; region eu-central-1; bucket blaze-media. These are non-secret local deployment values, not new remote validation. Agent never gets storage credentials. Script/facts go to OpenRouter for approved review, then approved task to Anthropic; public game origins to cloud browser; scoped Files to Blaze backend/private storage; authenticated dashboard preview/download to owner. No social service.

Actual Netlify plan/allowance remains unverified. Broad Dia read was automatically denied and not retried/bypassed. No installed Netlify CLI, expected CLI auth configuration or NETLIFY_AUTH_TOKEN was found in existing local deployment configuration; no account API credential was invented or copied. Scoped non-secret Usage page remains the existing pending access step, with no repeated nudge.

Parent-verified credit-plan rates:10credits/GB-hour,2credits/10k requests,15credits/deploy,300/month on Free; legacy plans may differ.30-day minute schedule is43,200 ticks plus up to43,200 route requests; request component8.64–17.28credits depending on tick treatment, before compute/deploy/other usage. No zero-cost claim. Existing Anthropic promo observations do not guarantee promo-only spending after exhaustion. No plan/billing change or purchased-credit expansion is approved.

Required approvals remain release, restricted environment/game metadata, monitor activation and exact paid attempts. Proposed video:20s9:16, minimal captions, motion graphics, generated music, native audio off, one$1 list-cost-threshold session, no retry/resume. Anthropic $4/M input/$20/M output plus$0.08/hour last verified; budget can overshoot. No enforceable upper total cost established. Show Jev's real score before the owner approves the exact script/settings. Live acceptance requires actual cloud play/capture/edit and the real MP4 appearing/playable/downloadable in this owner's Blaze dashboard—not a Console-only or mocked result.
