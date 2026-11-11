# Competitors

Open **Games → Competitors**, or choose **Competitors** in the navigation and select a game. Add up to ten peer listings. Use **My game’s listing** to link another platform for the selected game. A listing must be a public web game page, App Store game URL, or Google Play game URL. Apple and Android listings are identified by their numeric app ID and package name, respectively. Blaze never matches games by title alone.

Use **Add game → Mobile game** for a game that only has a store listing. This gives it a workspace and watchlist without web SDK settings. Blaze does not collect native gameplay events through this flow.

## Enable reports

Watchlist changes do not make provider calls. To enable **Refresh data**, set these server environment variables:

- `DATAFORSEO_LOGIN` and `DATAFORSEO_PASSWORD`: a DataForSEO API account with the required endpoints and billing.
- `BLAZE_COMPETITOR_WORKSPACE_IDS`: comma-separated, exact authenticated Blaze workspace IDs. Obtain these from the operator’s user records. An empty allowlist disables all reports.

The operator must have rights to display and store derived results for those users. Keep credentials on the server. See [DataForSEO’s data use explanation](https://dataforseo.com/help-center/quick-answers-to-frequently-asked-legal-questions). The source code license does not include the provider dataset.

Each refresh can make up to four billed calls: one Google organic SERP lookup, one bulk page-traffic lookup, and one bulk keyword lookup per mobile store. Search phrases are optional; leaving one blank skips the SERP call. The database enforces one refresh per workspace per minute bucket, eight per workspace per UTC day, and 24 per Blaze installation/database per UTC day. Provider prices and account credit limits still apply. No cron job, automatic retry or agent tool starts a refresh.

## Read the numbers

| Field | Meaning |
|---|---|
| Organic rank | The exact web page’s observed organic position in the first results page for the selected phrase, country, English language and device. **Not seen** means it was not matched in that snapshot. |
| Estimated monthly search visits | DataForSEO’s organic search estimate for the exact URL. This excludes other traffic channels and does not count visitors or players. |
| Ranked keywords / Top 10 | Count of keywords for the exact app ID in the provider’s store search index for the selected market. It is not an exhaustive ranking history. |
| Estimated keyword demand | The provider’s estimated search volume for the keywords in that app’s footprint. It is not an install, impression or revenue estimate. |
| — | No available observation for this row or source. Provider, region and app coverage vary. |

See the provider’s [Google SERP](https://docs.dataforseo.com/v3/serp-google-organic-live-advanced/), [page estimates](https://docs.dataforseo.com/v3/dataforseo_labs-google-bulk_traffic_estimation-live/), [App Store metrics](https://docs.dataforseo.com/v3/dataforseo_labs-apple-bulk_app_metrics-live/) and [Google Play metrics](https://docs.dataforseo.com/v3/dataforseo_labs-google-bulk_app_metrics-live/) definitions. The selected device applies to web rank. A shared website domain is never treated as a game page, and iOS and Android keyword coverage is shown separately.

Blaze keeps the last derived report and a previous comparable report when the watchlist, country, device and phrase match. It labels old results when a listing or filter changes. Failed sources stay unavailable; a total provider failure leaves the saved report intact. Raw provider responses, customer exports and MCP redistribution are not part of this feature.
