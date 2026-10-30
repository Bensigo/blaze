import { get, put, query } from "../src/lib/db";
import { prepareSourceIdeas } from "../src/lib/content-studio";
import type { Game } from "../src/lib/types";
// Explicit controlled workspace only; does not read production env or connect providers.
if (process.env.DATABASE_URL || process.env.NODE_ENV === "production" || process.env.BLAZE_CLOUD_PRODUCTION_ENABLED === "true") throw new Error("Local acceptance only");
const user = (await query<{ workspace_id: string }>("SELECT workspace_id FROM users WHERE id='local-developer'"))[0];
if (!user) throw new Error("Sign in to the isolated local workspace first");
const game: Game = { id: "studio_fixture", title: "Controlled token game", url: "https://fixture.example/token", description: "Controlled local acceptance data", image: "", genre: "Puzzle", sdkKey: "unused", origins: ["https://fixture.example"], competitors: [], dailyEnabled: false, createdAt: "2026-10-30T00:00:00Z" };
if (await get(user.workspace_id, "game", game.id)) throw new Error("Fixture already seeded");
await put(user.workspace_id, "game", game);
await put(user.workspace_id, "game_profile", { id: game.id, gameId: game.id, result: "complete", facts: [
  { key: "manifest_description", value: "Move a token along a path.", evidence: { source: "Controlled fixture manifest", observedAt: "2026-10-30T00:00:00Z" } },
  { key: "manifest_controls", value: "Arrow keys move the token.", evidence: { source: "Controlled fixture manifest", observedAt: "2026-10-30T00:00:00Z" } },
], prerequisites: [] });
await prepareSourceIdeas(user.workspace_id, game.id);
console.log("Controlled Content Studio fixture seeded. No provider calls.");
