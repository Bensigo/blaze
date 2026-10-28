import { randomBytes } from "node:crypto";
import { z } from "zod";
import { query, get, put, comparePut, rateLimit } from "./db";
import { hash, constantEqual } from "./security";
import { HttpError } from "./auth";
import { saveAsset, deleteAsset, cleanupStorageIntents } from "./media";
import { inspectCaptureVideo } from "./capture-video";
import type { Game, CaptureConfig, SessionCapture } from "./types";

export const CAPTURE_MAX_BYTES = 3 * 1024 * 1024;
const rect = z
  .object({
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    width: z.number().positive().max(1),
    height: z.number().positive().max(1),
  })
  .refine(
    (r) => r.x + r.width <= 1 && r.y + r.height <= 1,
    "Masks must fit within the game surface.",
  );
export const captureConfigSchema = z
  .object({
    enabled: z.boolean(),
    canvasSelector: z.string().trim().max(200),
    surfaceReviewed: z.boolean(),
    sampleRate: z.number().min(0.01).max(1),
    maxDurationSeconds: z.number().int().min(3).max(30),
    maxSegments: z.number().int().min(1).max(4).default(4),
    retentionDays: z.number().int().min(1).max(7),
    maxCapturesPerDay: z.number().int().min(1).max(100),
    masks: z.array(rect).max(8),
  })
  .refine(
    (c) => !c.enabled || (c.surfaceReviewed && c.canvasSelector.length > 0),
    "Confirm a gameplay-only canvas and provide its selector before enabling recordings.",
  );
export const defaultCaptureConfig: CaptureConfig = {
  enabled: false,
  canvasSelector: "",
  surfaceReviewed: false,
  sampleRate: 0.1,
  maxDurationSeconds: 30,
  maxSegments: 4,
  retentionDays: 1,
  maxCapturesPerDay: 25,
  masks: [],
};
export function captureSettings(game: Game): CaptureConfig {
  return captureConfigSchema.parse({
    ...defaultCaptureConfig,
    ...game.capture,
  });
}
export const captureLimits = {
  fps: 5,
  maxWidth: 960,
  maxHeight: 540,
  maxBytes: CAPTURE_MAX_BYTES,
  videoBitsPerSecond: 400000,
};
type Grant = {
  capture_id: string;
  workspace_id: string;
  game_id: string;
  session_id: string;
  origin: string;
  token_hash: string;
  expires_at: string | Date;
  state: string;
};
export function captureCors(origin: string) {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "600",
    Vary: "Origin",
    "Cache-Control": "no-store",
  };
}
export async function capturePreflight(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return new Response(null, { status: 403 });
  const row = await query(
    `SELECT id FROM records WHERE kind='game' AND body->'origins' ? $1 LIMIT 1`,
    [origin],
  );
  return new Response(null, {
    status: row.length ? 204 : 403,
    headers: row.length ? captureCors(origin) : {},
  });
}
export async function boundedJson(request: Request, max = 8192) {
  const reader = request.body?.getReader();
  if (!reader) throw new HttpError(400, "Missing request body.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const r = await reader.read();
    if (r.done) break;
    size += r.value.byteLength;
    if (size > max) {
      await reader.cancel();
      throw new HttpError(413, "Request too large.");
    }
    chunks.push(r.value);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString());
  } catch {
    throw new HttpError(400, "Invalid request.");
  }
}
async function gameByKey(sdkKey: string, origin: string) {
  const row = (
    await query<{ workspace_id: string; body: Game }>(
      `SELECT workspace_id,body FROM records WHERE kind='game' AND body->>'sdkKey'=$1`,
      [sdkKey],
    )
  )[0];
  if (!row || !row.body.origins.includes(origin))
    throw new HttpError(403, "This game origin is not authorized.");
  return row;
}
async function authenticate(
  captureId: string,
  token: string,
  origin: string,
): Promise<Grant> {
  if (!/^[a-zA-Z0-9_-]{8,100}$/.test(captureId) || token.length > 200)
    throw new HttpError(403, "Invalid recording grant.");
  const grant = (
    await query<Grant>(
      "SELECT * FROM session_capture_grants WHERE capture_id=$1",
      [captureId],
    )
  )[0];
  if (
    !grant ||
    grant.origin !== origin ||
    !constantEqual(grant.token_hash, hash(token))
  )
    throw new HttpError(403, "Recording grant is not authorized.");
  return grant;
}
export async function startCapture(input: unknown, origin: string) {
  const { sdkKey, sessionId, segment } = z
    .object({
      sdkKey: z.string().min(20).max(100),
      sessionId: z
        .string()
        .min(8)
        .max(100)
        .refine((s) => !s.startsWith("rec_") && !s.startsWith("agent_")),
      consent: z.literal(true),
      segment: z.number().int().min(0).max(3).default(0),
    })
    .parse(input);
  const { workspace_id: workspace, body: game } = await gameByKey(
    sdkKey,
    origin,
  );
  const config = captureSettings(game);
  if (!config.enabled) return { status: "disabled" };
  if (segment >= (config.maxSegments || 1))
    throw new HttpError(400, "This session reached its recording segment limit.");
  if (segment > 0) {
    const prior = await query(`SELECT capture_id FROM session_capture_grants WHERE workspace_id=$1 AND game_id=$2 AND session_id=$3 AND segment_index=$4 AND state='ready'`, [workspace, game.id, sessionId, segment - 1]);
    if (!prior.length) throw new HttpError(409, "The previous recording segment must finish before another starts.");
    const cancelled = await query(`SELECT capture_id FROM session_capture_grants WHERE workspace_id=$1 AND game_id=$2 AND session_id=$3 AND state='cancelled' LIMIT 1`, [workspace, game.id, sessionId]);
    if (cancelled.length) throw new HttpError(403, "Recording consent was withdrawn for this session.");
  }
  const event = (
    await query<{ player_id: string; page: string }>(
      `SELECT player_id,page FROM events WHERE workspace_id=$1 AND game_id=$2 AND session_id=$3 AND kind='human' AND name='visit' AND received_at>now()-interval '35 minutes' ORDER BY occurred_at DESC LIMIT 1`,
      [workspace, game.id, sessionId],
    )
  )[0];
  if (!event)
    throw new HttpError(
      409,
      "Wait for this consented human session to be received before recording.",
    );
  let pageOrigin = "";
  try {
    pageOrigin = new URL(event.page).origin;
  } catch {}
  if (pageOrigin !== origin)
    throw new HttpError(
      403,
      "The session does not belong to this game origin.",
    );
  const captureId = `capture_${hash(`${workspace}:${game.id}:${sessionId}${segment ? `:${segment}` : ""}`).slice(0, 32)}`;
  const previous = await get<SessionCapture>(
    workspace,
    "session_capture",
    captureId,
  );
  if (previous) {
    if (["not_sampled", "quota_reached"].includes(previous.status))
      return { status: previous.status, captureId };
    throw new HttpError(
      409,
      "A recording has already been requested for this game session.",
    );
  }
  const createdAt = new Date().toISOString(),
    expiresAt = new Date(
      Date.now() + config.retentionDays * 86400000,
    ).toISOString();
  let capture: SessionCapture = {
    id: captureId,
    gameId: game.id,
    sessionId,
    segment,
    playerId: event.player_id,
    status: "pending",
    createdAt,
    expiresAt,
  };
  const sampled =
    parseInt(hash(`${game.id}:${sessionId}`).slice(0, 8), 16) / 0x100000000 <
    config.sampleRate;
  if (!sampled) {
    capture = { ...capture, status: "not_sampled" };
    await put(workspace, "session_capture", capture);
    return { status: capture.status, captureId };
  }
  if (
    !(await rateLimit(
      `capture-day:${game.id}`,
      config.maxCapturesPerDay,
      86400,
    ))
  ) {
    capture = { ...capture, status: "quota_reached" };
    await put(workspace, "session_capture", capture);
    return { status: capture.status, captureId };
  }
  const token = randomBytes(32).toString("base64url");
  const rows = await query(
    `WITH granted AS (INSERT INTO session_capture_grants(capture_id,workspace_id,game_id,session_id,origin,token_hash,expires_at,state,segment_index) SELECT $1,$2,$3,$4,$5,$6,now()+interval '5 minutes','issued',$8 WHERE NOT EXISTS (SELECT 1 FROM session_capture_grants WHERE workspace_id=$2 AND game_id=$3 AND session_id=$4 AND state='cancelled') ON CONFLICT DO NOTHING RETURNING capture_id) INSERT INTO records(workspace_id,kind,id,body) SELECT $2,'session_capture',capture_id,$7::jsonb FROM granted RETURNING id`,
    [
      captureId,
      workspace,
      game.id,
      sessionId,
      origin,
      hash(token),
      JSON.stringify(capture),
      segment,
    ],
  );
  if (!rows.length)
    throw new HttpError(409, "This session already has a recording request.");
  return {
    status: "pending",
    captureId,
    token,
    config: { ...config, ...captureLimits },
    uploadUrl: "/api/capture/upload",
  };
}
const reasonCodes = new Set([
  "unsupported_browser",
  "unsupported_codec",
  "surface_missing",
  "surface_not_unique",
  "surface_not_canvas",
  "surface_tainted",
  "too_large",
  "consent_revoked",
  "upload_failed",
  "recording_failed",
  "surface_resized",
  "duration_limit",
  "no_frames",
  "cancelled",
  "capture_failed",
  "media_recorder_unavailable",
  "codec_unavailable",
  "canvas_capture_unavailable",
  "canvas_not_origin_clean",
  "invalid_config",
  "invalid_masks",
  "invalid_canvas_selector",
  "canvas_not_unique",
  "size_limit",
  "recorder_error",
  "empty_recording",
  "recorder_stop_failed",
  "capture_start_failed",
]);
export async function captureStatus(input: unknown, origin: string) {
  const v = z
    .object({
      captureId: z.string(),
      token: z.string(),
      status: z.enum(["unsupported", "failed"]),
      reason: z.string().max(80),
    })
    .parse(input);
  const grant = await authenticate(v.captureId, v.token, origin);
  const changed = await query(
    `UPDATE session_capture_grants SET state=$2 WHERE capture_id=$1 AND state='issued' AND expires_at>now() RETURNING capture_id`,
    [v.captureId, v.status],
  );
  if (!changed.length)
    throw new HttpError(409, "This recording grant is no longer active.");
  const cap = await get<SessionCapture>(
    grant.workspace_id,
    "session_capture",
    v.captureId,
  );
  if (cap?.status === "pending")
    await comparePut(grant.workspace_id, "session_capture", cap, {
      ...cap,
      status: v.status,
      reason: reasonCodes.has(v.reason) ? v.reason : "capture_failed",
    });
  return { status: v.status };
}
export async function uploadCapture(form: FormData, origin: string) {
  const captureId = String(form.get("captureId") || ""),
    token = String(form.get("token") || "");
  const grant = await authenticate(captureId, token, origin);
  const cap = await get<SessionCapture>(
    grant.workspace_id,
    "session_capture",
    captureId,
  );
  const game = await get<Game>(grant.workspace_id, "game", grant.game_id);
  if (
    !cap ||
    cap.status !== "pending" ||
    !game ||
    !game.origins.includes(origin) ||
    !captureSettings(game).enabled
  )
    throw new HttpError(409, "This recording is no longer permitted.");
  const file = form.get("file"),
    durationSeconds = Number(form.get("durationSeconds")),
    width = Number(form.get("width")),
    height = Number(form.get("height"));
  const config = captureSettings(game);
  const recordedAtValue = form.get("recordedAt");
  let recordedAt: string | undefined;
  if (recordedAtValue !== null) {
    if (typeof recordedAtValue !== "string" || !z.iso.datetime().safeParse(recordedAtValue).success)
      throw new HttpError(400, "Invalid recording start time.");
    const timestamp = Date.parse(recordedAtValue), grantTime = Date.parse(cap.createdAt);
    if (!Number.isFinite(timestamp) || !Number.isFinite(grantTime) || Math.abs(timestamp - grantTime) > 300000 || Math.abs(timestamp - Date.now()) > 300000)
      throw new HttpError(400, "Recording start time is outside the allowed window.");
    recordedAt = new Date(timestamp).toISOString();
  }
  if (!(file instanceof File) || !file.size || file.size > CAPTURE_MAX_BYTES)
    throw new HttpError(413, "Recording is missing or exceeds 3 MiB.");
  if (
    !Number.isFinite(durationSeconds) ||
    durationSeconds <= 0 ||
    durationSeconds > config.maxDurationSeconds ||
    !Number.isInteger(width) ||
    width < 1 ||
    width > 960 ||
    !Number.isInteger(height) ||
    height < 1 ||
    height > 540
  )
    throw new HttpError(400, "Recording limits were exceeded.");
  const verifiedVideo = await inspectCaptureVideo(
    new Uint8Array(await file.arrayBuffer()),
    config.maxDurationSeconds,
  );
  const claimed = await query(
    `UPDATE session_capture_grants g SET state='uploading' WHERE capture_id=$1 AND state='issued' AND expires_at>now() AND NOT EXISTS (SELECT 1 FROM session_capture_grants withdrawn WHERE withdrawn.workspace_id=g.workspace_id AND withdrawn.game_id=g.game_id AND withdrawn.session_id=g.session_id AND withdrawn.state='cancelled') RETURNING capture_id`,
    [captureId],
  );
  if (!claimed.length)
    throw new HttpError(409, "Recording grant expired or was already used.");
  let videoUrl: string | undefined;
  try {
    videoUrl = await saveAsset(
      grant.workspace_id,
      captureId,
      "session",
      file,
      undefined,
      { captureId, sessionId: cap.sessionId, expiresAt: cap.expiresAt },
    );
    const ready: SessionCapture = {
      ...cap,
      status: "ready",
      videoUrl,
      recordedAt,
      durationSeconds: verifiedVideo.durationSeconds,
      width: verifiedVideo.width,
      height: verifiedVideo.height,
      fps: verifiedVideo.fps,
      size: file.size,
      contentType: verifiedVideo.contentType,
      completedAt: new Date().toISOString(),
    };
    const active = (
      await query<Grant>(
        `SELECT g.* FROM session_capture_grants g WHERE capture_id=$1 AND state='uploading' AND NOT EXISTS (SELECT 1 FROM session_capture_grants withdrawn WHERE withdrawn.workspace_id=g.workspace_id AND withdrawn.game_id=g.game_id AND withdrawn.session_id=g.session_id AND withdrawn.state='cancelled')`,
        [captureId],
      )
    )[0];
    if (
      !active ||
      !(await comparePut(grant.workspace_id, "session_capture", cap, ready))
    ) {
      await deleteAsset(grant.workspace_id, videoUrl, captureId);
      throw new HttpError(
        409,
        "Recording was withdrawn before upload completed.",
      );
    }
    const finalized = await query(
      `UPDATE session_capture_grants SET state='ready' WHERE capture_id=$1 AND state='uploading' RETURNING capture_id`,
      [captureId],
    );
    if (!finalized.length) {
      await deleteAsset(grant.workspace_id, videoUrl, captureId);
      throw new HttpError(409, "Recording was withdrawn.");
    }
    return { status: "ready", captureId };
  } catch (error) {
    const changed = await query(
      `UPDATE session_capture_grants SET state='failed' WHERE capture_id=$1 AND state='uploading' RETURNING capture_id`,
      [captureId],
    );
    if (videoUrl)
      await deleteAsset(grant.workspace_id, videoUrl, captureId).catch(
        () => {},
      );
    if (changed.length) {
      const current = await get<SessionCapture>(
        grant.workspace_id,
        "session_capture",
        captureId,
      );
      if (current && ["pending", "ready"].includes(current.status))
        await comparePut(grant.workspace_id, "session_capture", current, {
          ...current,
          status: "failed",
          reason: "upload_failed",
          videoUrl: undefined,
        });
    }
    throw error;
  }
}
async function revokeCapture(
  workspace: string,
  captureId: string,
  reason: string,
) {
  await query(
    `UPDATE session_capture_grants SET state='cancelled' WHERE capture_id=$1 AND workspace_id=$2`,
    [captureId, workspace],
  );
  const cap = await get<SessionCapture>(
    workspace,
    "session_capture",
    captureId,
  );
  if (!cap) throw new HttpError(404, "Session recording not found.");
  const revoked: SessionCapture = {
    ...cap,
    status: "cancelled",
    reason,
    cleanupPending: !!cap.videoUrl,
  };
  await put(workspace, "session_capture", revoked);
  if (cap.videoUrl) {
    try {
      await deleteAsset(workspace, cap.videoUrl, cap.id);
      await comparePut(workspace, "session_capture", revoked, {
        ...revoked,
        videoUrl: undefined,
        cleanupPending: false,
      });
    } catch {
      /* Access is already revoked; retention cleanup retries storage deletion. */
    }
  }
  return { status: "cancelled" };
}
export async function cancelCapture(input: unknown, origin: string) {
  const v = z.object({ captureId: z.string(), token: z.string() }).parse(input);
  const grant = await authenticate(v.captureId, v.token, origin);
  // A single valid session grant withdraws all of that session's segments.
  const rows = await query<{capture_id: string}>(`UPDATE session_capture_grants SET state='cancelled' WHERE workspace_id=$1 AND game_id=$2 AND session_id=$3 RETURNING capture_id`, [grant.workspace_id, grant.game_id, grant.session_id]);
  for (const row of rows) await revokeCapture(grant.workspace_id, row.capture_id, "consent_revoked");
  return { status: "cancelled" };
}
export async function deleteOwnerCapture(workspace: string, captureId: string) {
  const cap = await get<SessionCapture>(workspace, "session_capture", captureId);
  if (!cap) throw new HttpError(404, "Session recording not found.");
  const rows = await query<{capture_id: string}>(`UPDATE session_capture_grants SET state='cancelled' WHERE workspace_id=$1 AND game_id=$2 AND session_id=$3 RETURNING capture_id`, [workspace, cap.gameId, cap.sessionId]);
  for (const row of rows) await revokeCapture(workspace, row.capture_id, "owner_deleted");
  if (!rows.length) await revokeCapture(workspace, captureId, "owner_deleted");
}
export async function cleanupCaptures() {
  const storageCleanup = await cleanupStorageIntents();
  const withdrawn = await query<{workspace_id: string; capture_id: string}>(`UPDATE session_capture_grants g SET state='cancelled' WHERE g.state<>'cancelled' AND EXISTS (SELECT 1 FROM session_capture_grants cancelled WHERE cancelled.workspace_id=g.workspace_id AND cancelled.game_id=g.game_id AND cancelled.session_id=g.session_id AND cancelled.state='cancelled') RETURNING workspace_id,capture_id`);
  for (const row of withdrawn) await revokeCapture(row.workspace_id, row.capture_id, "consent_revoked");
  const rows = await query<{ workspace_id: string; body: SessionCapture }>(
    `SELECT workspace_id,body FROM records WHERE kind='session_capture' AND (((body->>'expiresAt')::timestamptz<=now() AND body->>'status'<>'expired') OR (body->>'status' IN ('cancelled','expired') AND body->>'videoUrl' IS NOT NULL)) ORDER BY updated_at LIMIT 100`,
  );
  let expired = 0,
    failed = 0;
  for (const r of rows) {
    try {
      if (r.body.videoUrl)
        await deleteAsset(r.workspace_id, r.body.videoUrl, r.body.id);
      await put(r.workspace_id, "session_capture", {
        ...r.body,
        status: r.body.status === "cancelled" ? "cancelled" : "expired",
        videoUrl: undefined,
        cleanupPending: false,
        reason:
          r.body.status === "cancelled" ? r.body.reason : "retention_expired",
      });
      await query(
        `UPDATE session_capture_grants SET state='expired' WHERE capture_id=$1`,
        [r.body.id],
      );
      expired++;
    } catch {
      failed++;
    }
  }
  const abandoned = await query<Grant>(
    `UPDATE session_capture_grants SET state='failed' WHERE state IN ('issued','uploading') AND expires_at<now() RETURNING *`,
  );
  for (const g of abandoned) {
    const cap = await get<SessionCapture>(
      g.workspace_id,
      "session_capture",
      g.capture_id,
    );
    if (cap?.status === "pending")
      await comparePut(g.workspace_id, "session_capture", cap, {
        ...cap,
        status: "failed",
        reason: "upload_expired",
      });
  }
  const orphans = await query<{
    workspace_id: string;
    body: { id: string; captureId: string };
  }>(
    `SELECT m.workspace_id,m.body FROM records m LEFT JOIN session_capture_grants g ON g.capture_id=m.body->>'captureId' WHERE m.kind='media' AND m.body->>'captureId' IS NOT NULL AND (g.capture_id IS NULL OR g.state IN ('cancelled','expired','failed','unsupported')) LIMIT 100`,
  );
  for (const m of orphans) {
    try {
      await deleteAsset(
        m.workspace_id,
        `/api/media/${m.body.id}`,
        m.body.captureId,
      );
    } catch {
      failed++;
    }
  }
  return { expired, failed: failed + storageCleanup.failed };
}
