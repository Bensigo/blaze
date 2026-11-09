import { get, put } from "./db";
import type { Game } from "./types";

export type CitationEvidence = { id: string; gameId: string; source: "Owner-reported Bing AI Performance"; page: string; startDate: string; endDate: string; citations: number; importedAt: string };
const date = (value: unknown): value is string => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0,10) === value;
export function validateCitationEvidence(game: Game, input: unknown): CitationEvidence {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Invalid evidence.");
  const row = input as Record<string, unknown>;
  if (row.confirmed !== true || typeof row.page !== "string" || row.page.length > 2048 || !date(row.startDate) || !date(row.endDate) || row.startDate > row.endDate || row.endDate > new Date().toISOString().slice(0,10) || !Number.isSafeInteger(row.citations) || (row.citations as number) < 0 || (row.citations as number) > 1000000000) throw new Error("Enter a valid page, date range and citation count, and confirm the source.");
  let page: URL; let target: URL;
  try { page = new URL(row.page); target = new URL(game.url); } catch { throw new Error("Enter a valid game page URL."); }
  if (!["http:","https:"].includes(page.protocol) || page.username || page.password || page.search || page.hash || target.search || target.hash || page.href !== target.href) throw new Error("The cited page must exactly match the registered game URL.");
  return { id: game.id, gameId: game.id, source: "Owner-reported Bing AI Performance", page: page.href, startDate: row.startDate, endDate: row.endDate, citations: row.citations as number, importedAt: new Date().toISOString() };
}
export async function readCitationEvidence(workspace: string, game: Game) {
  const row = await get<CitationEvidence>(workspace,"citation_evidence",game.id);
  try { return row?.page === new URL(game.url).href ? row : undefined; } catch { return undefined; }
}
export async function saveCitationEvidence(workspace: string, game: Game, input: unknown) {
  return put(workspace,"citation_evidence",validateCitationEvidence(game,input));
}
