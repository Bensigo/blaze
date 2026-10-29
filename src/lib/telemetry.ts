import { z } from "zod";
import { query, rateLimit } from "./db";
import type { Game } from "./types";
import { hash } from "./security";
import { databaseUsage } from "./db-capacity";
import { visitorMetadata } from "./visitor-metadata";
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
    "active_play",
    "ui_click",
    "player_action",
    "milestone",
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
  onAccepted?: (workspace: string, gameId: string) => Promise<void>,
) {
  if (Number(request.headers.get("content-length") || 0) > 65536)
    return Response.json({ error: "Event batch too large" }, { status: 413 });
  const reader = request.body?.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  if (reader) {
    try {
      for (;;) {
        const part = await reader.read();
        if (part.done) break;
        size += part.value.byteLength;
        if (size > 65536) {
          await reader.cancel().catch(() => undefined);
          return Response.json(
            { error: "Event batch too large" },
            { status: 413 },
          );
        }
        chunks.push(part.value);
      }
    } finally {
      reader.releaseLock();
    }
  }
  const raw = Buffer.concat(chunks).toString("utf8");
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
  const usage = await databaseUsage();
  if (usage?.paused) return Response.json({ error: "Event ingestion is temporarily paused while database capacity is checked or managed." }, { status: 503, headers: { ...cors, "Retry-After": "30", "Cache-Control": "no-store" } });
  const { ip, country: visitorCountry } = visitorMetadata(request);
  if (!(await rateLimit(`events:${hash(`${game.id}:${ip}`)}`, 1200)))
    return Response.json(
      { error: "Event limit reached" },
      { status: 429, headers: cors },
    );
  const rows: Array<Record<string, unknown>> = [];
  for (const e of parsed.data.events) {
    const at = new Date(e.timestamp).getTime();
    if (at > Date.now() + 60000 || at < Date.now() - 7 * 86400000) continue;
    if (
      !synthetic &&
      (e.sessionId.startsWith("agent_") || e.sessionId.startsWith("rec_"))
    )
      continue;
    if (e.name === "active_play" && (synthetic || typeof e.properties.duration !== "number" || !Number.isInteger(e.properties.duration) || e.properties.duration < 0 || e.properties.duration > 15)) continue;
    let semantic: { key: string; value?: number } | undefined;
    if (["ui_click", "player_action", "milestone"].includes(e.name)) {
      const { key, value } = e.properties;
      if (typeof key !== "string" || !/^[A-Za-z0-9_-]{1,40}$/.test(key) ||
          (value !== undefined && (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1000000))) continue;
      semantic = value === undefined ? { key } : { key, value: value as number };
    }
    let pointer: { x: number; y: number; surface: "game" | "viewport"; screen: string } | undefined;
    if (e.name === "pointer") {
      const { x, y, surface, screen } = e.properties;
      if (typeof x !== "number" || !Number.isFinite(x) || x < 0 || x > 1 || typeof y !== "number" || !Number.isFinite(y) || y < 0 || y > 1) continue;
      if (surface === undefined && screen === undefined) pointer = { x, y, surface: "viewport", screen: "unknown" };
      else if ((surface === "game" || surface === "viewport") && typeof screen === "string" && /^[A-Za-z0-9_-]{1,40}$/.test(screen)) pointer = { x, y, surface, screen };
      else continue;
    }
    const country = synthetic ? "Synthetic" : visitorCountry;
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
    rows.push({
      // A marker establishes coverage; positive increments are capped to one per
      // 15-second session bucket, regardless of client event IDs or retries.
      id: e.name === "active_play"
        ? hash(`${workspace}:${game.id}:${session}:active_play:${e.properties.duration === 0 ? "marker" : Math.floor(at / 15000)}`)
        : hash(`${game.id}:${e.id}:${synthetic ? "agent" : "human"}`),
      session_id: session,
      player_id: player,
      name: e.name,
      occurred_at: e.timestamp,
      country,
      device: ["mobile", "tablet", "desktop"].includes(e.device || "")
        ? e.device
        : "Unknown",
      source: source.slice(0, 100),
      campaign: e.campaign || "",
      page: safePage(e.page),
      properties: { ...(semantic || pointer || properties(e.properties)), ...(e.properties.test === true ? { test: true } : {}) },
    });
  }
  if (!rows.length) return Response.json({ accepted: 0 }, { headers: cors });
  const [result] = await query<{ accepted: number }>(
    `WITH incoming AS (
       SELECT item, ord FROM jsonb_array_elements($1::jsonb) WITH ORDINALITY AS e(item,ord)
     ), inserted AS (
       INSERT INTO events(id,workspace_id,game_id,session_id,player_id,kind,name,occurred_at,country,device,source,campaign,page,properties)
       SELECT item->>'id',$2,$3,item->>'session_id',item->>'player_id',$4,item->>'name',
         (item->>'occurred_at')::timestamptz,item->>'country',item->>'device',item->>'source',
         item->>'campaign',item->>'page',item->'properties'
       FROM incoming ORDER BY ord ON CONFLICT(id) DO NOTHING
       RETURNING workspace_id,game_id,player_id,kind,occurred_at,session_id
     ) SELECT count(*)::int AS accepted FROM inserted`,
    [JSON.stringify(rows), workspace, game.id, synthetic ? "agent" : "human"],
  );
  const accepted = result.accepted;
  if (accepted > 0 && !synthetic && onAccepted) {
    try { await onAccepted(workspace!, game.id); }
    catch (error) { console.error("Human profile refresh deferred", error instanceof Error ? error.name : "UnknownError"); }
  }
  return Response.json({ accepted }, { headers: cors });
}
