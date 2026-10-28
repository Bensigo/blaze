import { z } from "zod";
import { query, rateLimit } from "./db";
import type { Game } from "./types";
import { hash } from "./security";
const short = z.string().max(100);
const eventSchema = z.object({
  id: z.string().min(8).max(100),
  name: z.enum([
    "visit",
    "loaded",
    "first_action",
    "round_start",
    "round_complete",
    "retry",
    "progression",
    "error",
    "exit",
    "pointer",
  ]),
  sessionId: z.string().min(8).max(100),
  playerId: z.string().min(8).max(100),
  timestamp: z.iso.datetime(),
  properties: z.record(z.string(), z.unknown()).default({}),
  page: z.string().max(2048).default(""),
  referrer: z.string().max(2048).default(""),
  campaign: short.optional(),
  source: short.optional(),
  device: short.optional(),
});
export const collectSchema = z.object({
  sdkKey: z.string().min(20).max(100),
  events: z.array(eventSchema).min(1).max(50),
});
function safePage(value: string) {
  try {
    const u = new URL(value);
    return /^https?:$/.test(u.protocol)
      ? `${u.origin}${u.pathname}`.slice(0, 500)
      : "";
  } catch {
    return "";
  }
}
function properties(input: Record<string, unknown>) {
  const out: Record<string, string | number> = {};
  for (const key of ["step", "level", "result", "code", "x", "y", "duration"]) {
    const v = input[key];
    if (typeof v === "number" && Number.isFinite(v)) out[key] = v;
    if (typeof v === "string" && /^[a-zA-Z0-9_.:-]{1,80}$/.test(v))
      out[key] = v;
  }
  return out;
}
export async function ingest(
  request: Request,
  synthetic?: { workspace: string; game: Game; recordingId: string },
) {
  if (Number(request.headers.get("content-length") || 0) > 65536)
    return Response.json({ error: "Event batch too large" }, { status: 413 });
  const raw = await request.text();
  if (Buffer.byteLength(raw) > 65536)
    return Response.json({ error: "Event batch too large" }, { status: 413 });
  let input;
  try {
    input = JSON.parse(raw);
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = collectSchema.safeParse(
    synthetic ? { ...input, sdkKey: synthetic.game.sdkKey } : input,
  );
  if (!parsed.success)
    return Response.json({ error: "Invalid telemetry batch" }, { status: 400 });
  let workspace = synthetic?.workspace,
    game = synthetic?.game;
  if (!game) {
    const row = (
      await query<{ workspace_id: string; body: Game }>(
        `SELECT workspace_id,body FROM records WHERE kind='game' AND body->>'sdkKey'=$1`,
        [parsed.data.sdkKey],
      )
    )[0];
    if (!row)
      return Response.json({ error: "Unknown game key" }, { status: 403 });
    workspace = row.workspace_id;
    game = row.body;
  }
  const origin = request.headers.get("origin");
  const allowed = !!origin && game.origins.includes(origin);
  const cors: Record<string, string> = allowed
    ? { "Access-Control-Allow-Origin": origin!, Vary: "Origin" }
    : {};
  if (!synthetic && !allowed)
    return Response.json(
      { error: "This origin is not allowed for the game" },
      { status: 403 },
    );
  const ip = process.env.VERCEL
    ? (request.headers.get("x-forwarded-for") || "unknown").split(",")[0]
    : "local";
  if (!(await rateLimit(`events:${hash(`${game.id}:${ip}`)}`, 1200)))
    return Response.json(
      { error: "Event limit reached" },
      { status: 429, headers: cors },
    );
  let accepted = 0;
  for (const e of parsed.data.events) {
    const at = new Date(e.timestamp).getTime();
    if (at > Date.now() + 60000 || at < Date.now() - 7 * 86400000) continue;
    if (
      !synthetic &&
      (e.sessionId.startsWith("agent_") || e.sessionId.startsWith("rec_"))
    )
      continue;
    const country = synthetic
      ? "Synthetic"
      : process.env.VERCEL
        ? (request.headers.get("x-vercel-ip-country") || "Unknown").slice(0, 3)
        : "Unknown";
    let source = e.source || "";
    if (!source) {
      try {
        source = e.referrer ? new URL(e.referrer).hostname : "Direct";
      } catch {
        source = "Direct";
      }
    }
    const session = synthetic ? synthetic.recordingId : e.sessionId,
      player = synthetic ? synthetic.recordingId : e.playerId;
    const inserted = await query<{ id: string }>(
      `INSERT INTO events(id,workspace_id,game_id,session_id,player_id,kind,name,occurred_at,country,device,source,campaign,page,properties) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb) ON CONFLICT(id) DO NOTHING RETURNING id`,
      [
        hash(`${game.id}:${e.id}:${synthetic ? "agent" : "human"}`),
        workspace,
        game.id,
        session,
        player,
        synthetic ? "agent" : "human",
        e.name,
        e.timestamp,
        country,
        ["mobile", "tablet", "desktop"].includes(e.device || "")
          ? e.device
          : "Unknown",
        source.slice(0, 100),
        e.campaign || "",
        safePage(e.page),
        JSON.stringify(properties(e.properties)),
      ],
    );
    accepted += inserted.length;
  }
  return Response.json({ accepted }, { headers: cors });
}
