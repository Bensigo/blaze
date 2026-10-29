# X feedback connection and collection

**Blocked by default:** No real paid X verification is approved. Blaze currently cannot enforce an X-side total spending cap covering all charges, including identity, search and unknown extras. Connect, callback completion, refresh and search are blocked at their routes; no environment flag enables them. The estimates and request limits below are not a spending cap. An approved, concrete provider-side total budget arrangement and implementation are prerequisites for any future paid verification.

This capability is separate from X publishing. It does not post, follow, message or subscribe, and daily research does not search X. No real account, entitlement, pricing or search has been tested by this implementation.

## Consent and identity

Configure a **separate** confidential X OAuth 2.0 web app and set `X_FEEDBACK_CLIENT_ID` and `X_FEEDBACK_CLIENT_SECRET`; register the exact canonical callback `/api/social/x_feedback/callback`. This document does not authorize configuring an app or credentials. The connection screen must disclose the exact requested scopes before a user explicitly connects:

- `tweet.read`: read posts the authorized account can view;
- `users.read`: read accounts the authorized account can view;
- `offline.access`: remain connected until revoked, allowing token refresh.

These scopes can cover protected content the account can view, though this feature only invokes recent search. They do not grant publishing, media, follows or messages. X's consent screen is authoritative. The app requests PKCE and verifies the returned scopes and identity; unexpected scopes are rejected. OAuth exchange calls `GET /2/users/me`, which can incur a read charge. A connected identity proves neither search entitlement nor available credits. No search is performed to test it.

The prepared client would submit `POST /api/social/x_feedback/connect` after the block is replaced by a verified, approved cap with `{ "readOnlyConsent": true }`, then navigates to the returned OAuth URL. Existing browser-bound, one-time state and workspace ownership protect the callback. Reconnection includes its owned `connectionId` and the same explicit consent. The connection's separate credential is encrypted and cannot be used as the publishing destination. Disconnect uses the existing social disconnect flow. When an access token expires, the user must explicitly reconnect before collection; collection does not silently refresh or make an extra identity request.

## Manual collection

`GET /api/games/{id}/feedback` is workspace-scoped and returns the title-derived query, a maximum of 10 results, identity state, `not_tested` search entitlement and grouped persisted findings. The blocked `POST` is designed to require same-origin authentication, ownership, and `{ "confirmSearchAndCost": true }`. Once approved and enforceable, the UI must show the actual query and explain that this authorizes **one** X recent-search request, up to 10 returned posts and a potential charge. It must require a fresh confirmation every run. There is no pagination, retry, automatic background search, model call, identity refresh or publication in this operation. A planned 6-per-hour workspace limit is a rate limit, not a spending cap; failures may still be billable.

As checked 29 October 2026, [X pricing](https://docs.x.com/x-api/getting-started/pricing) lists $0.005 per Post read and $0.010 per User read. Ten returned posts therefore suggest $0.05 for those post reads at the listed rate, excluding identity and other unknown charges. The flow would make one search request with up to ten posts; connecting would also perform one user identity lookup, and there may be other charges. These request/resource bounds do not enforce a total spend limit. Rates, billing and eligibility can change; check the Developer Console before connecting or running. This estimate is not a guaranteed cap or a grant to buy credits, save a card, enable recharge or spend. X describes credit billing, per-resource reads, and soft same-day deduplication; entitlement, account billing configuration, and actual charges remain unknown.

The [recent search endpoint](https://docs.x.com/x-api/posts/search-recent-posts) is incomplete by design and may require paid access or credits. The [OAuth scopes documentation](https://docs.x.com/fundamentals/authentication/oauth-2-0/authorization-code) describes their breadth and refresh behavior. A successful call proves access only for that request. A failed call reports a sanitized HTTP status and may have incurred charges; inspect access, quota and billing before retrying.

Returned posts become same-game Finding records with source URL/date. Classification is a simple text heuristic; it may be wrong. A post containing the game URL is marked direct, otherwise relevance is possible and must be reviewed. Bug reports and requests are claims, not verified reproductions; even a direct URL requires context review. Repeated source IDs do not overwrite existing findings or owner statuses. Results do not represent all players or all discussion.
