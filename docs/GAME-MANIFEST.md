# Optional game manifest

Blaze can import any public game page from its HTML metadata. A compatible version-1 public game manifest is optional; if supplied at the entered game URL plus `/forever.json`, its validated metadata takes precedence. The filename is the existing integration protocol; an independent web game can implement it without being hosted on Forever.

For `https://games.example/my-game`, serve JSON at `https://games.example/my-game/forever.json`. For a file-like game URL ending `/index.html`, serve the manifest at `/index.html/forever.json`. Blaze does not substitute a site-root URL or follow redirects. Use public HTTP/HTTPS without credentials, query strings or fragments. Private addresses are rejected.

Use the complete [controlled fixture manifest](../src/lib/controlled-fixture-manifest.json) as a structural example and the [version-1 validator](../src/lib/forever-json-consumer.ts) as the authoritative contract. Replace the fixture identity, metadata, rules, controls, media and visibility with truthful details for your game. Imported source facts keep their source URL, version, observation time and hash; later owner edits are separate.

Important fields include `formatVersion`, `id`, `slug`, `name`, `genre`, maker/release dates, tagline/description/about, player counts and modes, guest-play status, controls/devices, session/cost descriptions, how-to-play steps, FAQ, age rating, cover/share/screenshot/trailer media and visibility. Validate the entire document; a JSON file with a title alone does not satisfy the protocol.

For local acceptance only, set `APP_URL` to your local Blaze origin and import exactly `<APP_URL>/fixture/index.html` in development. This permits only that controlled fixture, not arbitrary private or localhost game URLs. It is not enabled in production.

The public SDK key shown after import is intended for browser event collection. The opaque Blaze game ID identifies workspace records; it is distinct from the manifest's own ID. Never put server credentials, database passwords or MCP tokens in a manifest or game page.
