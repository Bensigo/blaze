import { get, list, query } from "./db";
import { decrypt, hash } from "./security";
import { HttpError } from "./http-error";
import { X_FEEDBACK_BUDGET_BLOCK } from "./x-feedback-policy";
import { xFeedbackAdapter } from "./social-x-youtube";
import type { Connection, Finding, Game } from "./types";

export type FeedbackCategory = "mention" | "reported_bug" | "feature_request";
export type XFeedbackFinding = Finding & { feedback: { sourceId: string; category: FeedbackCategory; relevance: "direct" | "possible"; publishedAt: string; verification: "reported_not_reproduced" } };
export const X_FEEDBACK_LIMIT = 10;
export function classifyFeedback(text: string): FeedbackCategory {
  if (/\b(bug|broken|crash(?:es|ed|ing)?|glitch|freeze[sd]?|doesn.t work|not working)\b/i.test(text)) return "reported_bug";
  if (/\b(wish|please add|feature request|would (?:love|like)|should add|could you add)\b/i.test(text)) return "feature_request";
  return "mention";
}
export function feedbackQuery(game: Game) {
  const title = game.title.replace(/[^\p{L}\p{N} ]/gu, " ").replace(/\s+/g, " ").trim().slice(0, 80);
  if (title.length < 3) throw new HttpError(400, "The game needs a searchable title of at least three letters or numbers.");
  return `"${title}" -is:retweet`;
}
export async function readFeedback(workspace: string, game: Game) {
  const findings = (await list<XFeedbackFinding>(workspace, "finding")).filter((f) => f.gameId === game.id && f.feedback && /^\d+$/.test(f.feedback.sourceId));
  const groups = { mentions: [] as XFeedbackFinding[], reportedBugs: [] as XFeedbackFinding[], featureRequests: [] as XFeedbackFinding[] };
  for (const finding of findings) {
    const category = finding.feedback.category;
    if (category === "reported_bug") groups.reportedBugs.push(finding);
    else if (category === "feature_request") groups.featureRequests.push(finding);
    else groups.mentions.push(finding);
  }
  const connection = (await list<Connection>(workspace, "connection")).find((c) => c.provider === "x_feedback" && c.connected && c.authMethod === "oauth");
  return { query: feedbackQuery(game), limit: X_FEEDBACK_LIMIT, spendCap: "not_enforced", blocked: true, blockedReason: X_FEEDBACK_BUDGET_BLOCK, configured: xFeedbackAdapter.configured(), identity: connection ? "connected" : "disconnected", needsReconnect: !!connection && (!!connection.requiresReconnect || !connection.expiresAt || !Number.isFinite(Date.parse(connection.expiresAt)) || Date.parse(connection.expiresAt) <= Date.now() + 300000), entitlement: "not_tested", groups };
}
export async function collectFeedback(workspace: string, game: Game) {
  const search = feedbackQuery(game);
  const connection = (await list<Connection>(workspace, "connection")).find((c) => c.provider === "x_feedback" && c.connected && c.authMethod === "oauth");
  if (!connection || connection.requiresReconnect || !connection.expiresAt || !Number.isFinite(Date.parse(connection.expiresAt)) || Date.parse(connection.expiresAt) <= Date.now() + 300000 || !["tweet.read", "users.read", "offline.access"].every(s => connection.scopes?.includes(s)) || connection.scopes?.some(s => !["tweet.read", "users.read", "offline.access"].includes(s))) throw new HttpError(409, "Connect or reconnect a separate read-only X feedback account first. Search entitlement is not tested.");
  const row = (await query<{ encrypted: string }>("SELECT encrypted FROM credentials WHERE workspace_id=$1 AND provider=$2", [workspace, connection.id]))[0];
  if (!row) throw new HttpError(409, "Read-only X feedback authorization is unavailable. Reconnect first.");
  const secret = await decrypt(row.encrypted);
  const scopes = secret.scopes;
  if (!secret.token || !Array.isArray(scopes) || !["tweet.read", "users.read", "offline.access"].every(s => scopes.includes(s)) || scopes.some(s => !["tweet.read", "users.read", "offline.access"].includes(s))) throw new HttpError(409, "Read-only X feedback authorization is unavailable. Reconnect first.");
  const params = new URLSearchParams({ query: search, max_results: String(X_FEEDBACK_LIMIT), "tweet.fields": "created_at" });
  let response: Response;
  try { response = await fetch(`https://api.x.com/2/tweets/search/recent?${params}`, { headers: { Authorization: `Bearer ${secret.token}` }, redirect: "error", cache: "no-store", signal: AbortSignal.timeout(10000) }); }
  catch { throw new HttpError(502, "X search failed or timed out; access and charges are unknown. Check X before retrying."); }
  if (!response.ok) throw new HttpError(response.status === 401 || response.status === 403 ? 403 : 502, `X search was unavailable (HTTP ${response.status}); check entitlement, credentials, quota and charges before retrying.`);
  let payload: any;
  try { const text = await response.text(); if (text.length > 262144) throw new Error(); payload = JSON.parse(text); } catch { throw new HttpError(502, "X returned an invalid or oversized response; charges are unknown."); }
  if (!payload || typeof payload !== "object" || (payload.data !== undefined && !Array.isArray(payload.data)) || (payload.errors && !payload.data)) throw new HttpError(502, "X search returned incomplete or invalid results; charges are unknown.");
  const rows = (payload.data || []).slice(0, X_FEEDBACK_LIMIT);
  let saved = 0;
  for (const row of rows) {
    if (!/^\d{1,30}$/.test(String(row?.id)) || typeof row.text !== "string" || typeof row.created_at !== "string" || !Number.isFinite(Date.parse(row.created_at))) continue;
    const sourceId = String(row.id), excerpt = row.text.replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, 500);
    const category = classifyFeedback(excerpt), gameUrl = game.url.toLowerCase();
    const relevance = gameUrl && excerpt.toLowerCase().includes(gameUrl) ? "direct" : "possible";
    const title = category === "reported_bug" ? "X: reported bug" : category === "feature_request" ? "X: feature request" : "X: mention";
    const finding: XFeedbackFinding = { id: `finding_${hash(`x-feedback:${game.id}:${sourceId}`).slice(0, 24)}`, gameId: game.id, title, detail: `${excerpt} — ${relevance === "direct" ? "Game URL appears in the post; context still needs review." : "Possible game relevance; verify context."} This is a reported claim, not a verified reproduction.`, type: "observation", priority: "low", evidence: [{ label: `X post, ${new Date(row.created_at).toISOString()}`, url: `https://x.com/i/web/status/${sourceId}` }], status: "open", createdAt: new Date().toISOString(), feedback: { sourceId, category, relevance, publishedAt: new Date(row.created_at).toISOString(), verification: "reported_not_reproduced" } };
    // Atomic insert-only dedup prevents a repeat collection from overwriting owner status or notes.
    const inserted = await query("INSERT INTO records(workspace_id,kind,id,body) VALUES($1,'finding',$2,$3::jsonb) ON CONFLICT(workspace_id,kind,id) DO NOTHING RETURNING id", [workspace, finding.id, JSON.stringify(finding)]);
    saved += inserted.length;
  }
  return { ...(await readFeedback(workspace, game)), entitlement: payload.errors ? "partial" : "available_for_this_request", returned: rows.length, saved, limitations: "Recent search is incomplete; matches and reported bugs require review. No reproduction was performed." };
}
