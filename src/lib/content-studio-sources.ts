import { get, type TransactionQuery } from "./db";
import { HttpError } from "./http-error";
import { hash } from "./security";
import { readProfile } from "./game-profile";
import type { Game } from "./types";
const getGame = async (workspace: string, gameId: string) => {
  const game = await get<Game>(workspace, "game", gameId);
  if (!game) throw new HttpError(404, "Game not found.");
  return game;
};
export async function gameSources(workspace: string, gameId: string, sql?: TransactionQuery) {
  const game = sql ? (await sql<{ body: Game }>(`SELECT body FROM records WHERE workspace_id=$1 AND kind='game' AND id=$2 FOR UPDATE`, [workspace, gameId]))[0]?.body : await getGame(workspace, gameId);
  if (!game) throw new HttpError(404, "Game not found.");
  const profile = sql ? (await sql<{ body: { facts: Awaited<ReturnType<typeof readProfile>>["facts"] } }>(`SELECT body FROM records WHERE workspace_id=$1 AND kind='game_profile' AND id=$2 FOR UPDATE`, [workspace, gameId]))[0]?.body : await readProfile(workspace, gameId);
  // Only source-backed game capabilities. No private telemetry, player IDs, credentials or owner overrides.
  const facts = (profile?.facts || []).filter(f => /^(manifest_(name|description|genre|controls|rules|about:|faq:)|page_(title|description))/.test(f.key))
    .slice(0, 30).map(f => ({ key: f.key, value: f.value.slice(0, 1600), evidence: f.evidence }));
  if (!facts.length) throw new HttpError(409, "Investigate this game's profile before preparing video ideas. No source-backed game facts are available.");
  const url = new URL(game.url); url.search = ""; url.hash = "";
  if (url.protocol !== "https:" || url.username || url.password) throw new HttpError(409, "A public HTTPS game URL is required.");
  const networkPolicy = game.networkPolicy || { resourceOrigins: [], webSocketOrigins: [] };
  return { gameId, title: game.title, url: url.href, facts, networkPolicy, revision: hash(JSON.stringify({ url: url.href, manifest: game.manifestSource, facts, networkPolicy })) };
}
