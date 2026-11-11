import { syncForeverCatalogue } from "@/lib/forever-catalogue";
import { after } from "next/server";
import { createGameWithProfile, drainProfile } from "@/lib/game-profile";
import { verifyNetworkPolicy } from "@/lib/network-policy";
import { captureConfigSchema, deleteOwnerCapture } from "@/lib/session-capture";
import { z } from "zod";
import { requireIdentity, apiError, HttpError } from "@/lib/auth";
import { get, list, put, remove, query, id, rateLimit, transaction } from "@/lib/db";
import { sameOrigin, publicOrigin } from "@/lib/security";
import { saveSecret } from "@/lib/credentials";
import { gameMetadata, imageUrl } from "@/lib/metadata";
import { verifySearchConsole } from "@/lib/integrations/search-console";
import type { Game, Finding, Connection, ProviderSecret } from "@/lib/types";
import { createReleaseMeasurement } from "@/lib/measurements";
import { saveFindingNote, setFindingDecision } from "@/lib/finding-decisions";
import { validateMeasurementWindows } from "@/lib/measurement-outcomes";
import { competitorTarget } from "@/lib/competitors";
const str = z.string().trim().min(1).max(500);
const rid = z.string().max(100);
export async function POST(request: Request) {
  try {
    if (!sameOrigin(request))
      throw new HttpError(403, "Use this workspace to make changes.");
    const user = await requireIdentity(),
      workspace = user.workspace_id;
    if (Number(request.headers.get("content-length") || 0) > 32000)
      throw new HttpError(413, "Request too large.");
    const text = await request.text();
    if (text.length > 32000) throw new HttpError(413, "Request too large.");
    const body = JSON.parse(text);
    const action = z.string().max(50).parse(body.action);
    if (!(await rateLimit(`actions:${workspace}`, 120)))
      throw new HttpError(429, "Too many requests. Try again shortly.");
    const requireRecord = async <T>(kind: string, key: unknown) => {
      const item = await get<T>(workspace, kind, rid.parse(key));
      if (!item) throw new HttpError(404, `${kind} not found.`);
      return item;
    };
    if(action === 'sync_forever_catalogue') return Response.json(await syncForeverCatalogue(workspace));
    if (action === "inspect_game" || action === "add_game") {
      const v = z.object({ url: z.string().max(2000) }).parse(body);
      const metadata = await gameMetadata(v.url, publicOrigin(request));
      if (action === "inspect_game") return Response.json({ metadata });
      const game: Game = {
        ...metadata,
        id: id("game"),
        sdkKey: id("sdk"),
        origins: [new URL(metadata.url).origin],
        createdAt: new Date().toISOString(),
        dailyEnabled: true,
        competitors: [],
      };
      const jobId = await createGameWithProfile(workspace, game, metadata, publicOrigin(request));
      try { after(async () => { await drainProfile(jobId); }); } catch { /* The durable job remains for the worker or cron. */ }
      return Response.json({ game });
    }
    if (action === "add_mobile_game") {
      const v = z.object({ url: z.string().trim().max(2000), title: z.string().trim().min(1).max(120) }).parse(body);
      const target = competitorTarget(v);
      if (target.platform === "web") throw new HttpError(400, "Use an App Store or Google Play game link.");
      const game: Game = {
        id: "game_store_" + target.id, storePlatform: target.platform,
        title: target.title, url: target.url, description: "", image: "", genre: "",
        sdkKey: id("sdk"), origins: [], createdAt: new Date().toISOString(),
        dailyEnabled: false, competitors: [], metadataStatus: "Store listing",
      };
      if (await get(workspace, "archived_game", game.id))
        throw new HttpError(409, "Restore this game from Archived games.");
      await query(
        "INSERT INTO records(workspace_id, kind, id, body) VALUES($1,'game',$2,$3::jsonb) ON CONFLICT DO NOTHING",
        [workspace, game.id, JSON.stringify(game)],
      );
      return Response.json({ game: await get<Game>(workspace, "game", game.id) });
    }
    if (action === "update_game") {
      const game = await requireRecord<Game>("game", body.id);
      const v = z
        .object({
          title: z.string().trim().min(1).max(120).optional(),
          description: z.string().max(500).optional(),
          image: z.string().max(2000).optional(),
          genre: z.string().max(80).optional(),
          origins: z.array(z.string().url()).max(10).optional(),
          competitors: z.array(z.string().url()).max(5).optional(),
          dailyEnabled: z.boolean().optional(),
          networkPolicy: z.unknown().optional(),
          capture: captureConfigSchema.optional(),
        })
        .parse(body);
      if (game.storePlatform && (v.origins !== undefined || v.networkPolicy !== undefined || v.capture !== undefined))
        throw new HttpError(400, "Browser telemetry settings are available for web games.");
      if ((typeof body.expectedSourceUrl === "string" && body.expectedSourceUrl !== game.url) || (game.sourceUrlRevision && body.expectedSourceRevision !== game.sourceUrlRevision)) throw new HttpError(409,"Game source changed since these settings were opened. Reload before editing.");
      let networkPolicy = game.networkPolicy;
      if (body.networkPolicy !== undefined) {
        try {
          const incoming = body.networkPolicy;
          const policyInput = incoming && typeof incoming === "object" && !Array.isArray(incoming)
            ? { ...incoming, frameUrls: "frameUrls" in incoming ? incoming.frameUrls : game.networkPolicy?.frameUrls || [] }
            : incoming;
          networkPolicy = await verifyNetworkPolicy(policyInput);
          if (networkPolicy.frameUrls?.some(url => new URL(url).origin !== new URL(game.url).origin))
            throw new Error("Reviewed frame URLs must share the game origin.");
        } catch (e) {
          throw new HttpError(
            400,
            e instanceof Error ? e.message : "Invalid network permissions.",
          );
        }
      }
      const origins = v.origins?.map((s) => {
        const u = new URL(s);
        if (
          !["http:", "https:"].includes(u.protocol) ||
          u.username ||
          u.password
        )
          throw new HttpError(400, "Use HTTP(S) origins.");
        return u.origin;
      });
      await transaction(async sql => {
        const current=(await sql<{body:Game}>("SELECT body FROM records WHERE workspace_id=$1 AND kind='game' AND id=$2 FOR UPDATE",[workspace,game.id]))[0]?.body;
        if(!current)throw new HttpError(404,"Active game not found.");
        if(current.url!==game.url || current.sourceUrlRevision!==game.sourceUrlRevision)throw new HttpError(409,"Game source changed while saving. Reload before editing settings.");
        const next={...current,...v,networkPolicy,...(origins?{origins}:{}),image:v.image===undefined?current.image:imageUrl(v.image,current.url)};
        await sql("UPDATE records SET body=$3::jsonb,updated_at=now() WHERE workspace_id=$1 AND kind='game' AND id=$2",[workspace,game.id,JSON.stringify(next)]);
      });
      return Response.json({ ok: true });
    }
    if (action === "save_connection") {

      const v = z
        .object({
          provider: z.literal("search_console"),
          label: str,
          token: z.string().min(8).max(10000),
          accountId: z.string().max(200).optional(),
          refreshToken: z.string().max(10000).optional(),
        })
        .parse(body);
      const secret: ProviderSecret = {
        token: v.token,
        ...(v.accountId ? { accountId: v.accountId } : {}),
        ...(v.refreshToken ? { refreshToken: v.refreshToken } : {}),
      };
      const checked = await verifySearchConsole(secret);
      if (!checked.connected) throw new HttpError(400, checked.details);
      secret.accountId = checked.accountId || v.accountId;
      const existing = (await list<Connection>(workspace, "connection")).find(
        (c) => c.provider === v.provider && c.accountId === secret.accountId,
      );
      const connection: Connection = {
        id: existing?.id || id("conn"),
        provider: v.provider,
        label: v.label,
        accountId: secret.accountId,
        connected: true,
        checkedAt: new Date().toISOString(),
        details: checked.details,
        authMethod: "manual",
      };
      await saveSecret(workspace, connection.id, secret);
      await put(workspace, "connection", connection);
      return Response.json({ connection });
    }
    if (action === "delete_connection") {
      const connection = await requireRecord<Connection>("connection", body.id);
      if (connection.provider !== "search_console") throw new HttpError(404, "Connection not found.");
      if (connection.authMethod === "oauth")
        throw new HttpError(400, "Use the account disconnect action so provider revocation is attempted.");
      await query(
        "DELETE FROM credentials WHERE workspace_id=$1 AND provider=$2",
        [workspace, connection.id],
      );
      await remove(workspace, "connection", connection.id);
      return Response.json({ ok: true });
    }
    if (action === "delete_session_capture") {
      await deleteOwnerCapture(workspace, rid.parse(body.id));
      return Response.json({ ok: true });
    }
    if (action === "start_measurement") {
      const finding = await requireRecord<Finding>("finding", body.findingId);
      const window = z.object({ start: z.string().max(30), end: z.string().max(30) });
      const input = z.object({
        gameId: rid,
        findingId: rid,
        note: z.string().trim().min(3).max(500),
        release: z.object({
          version: str,
          description: str,
          evidenceUrl: z.string().url().max(2000),
          effectiveAt: z.string().max(30),
        }),
        baselineWindow: window,
        followupWindow: window,
      }).parse(body);
      await requireRecord<Game>("game", input.gameId);
      if (input.gameId !== finding.gameId) throw new HttpError(400, "Choose the finding's game.");
      try { validateMeasurementWindows(input.release, input.baselineWindow, input.followupWindow); }
      catch (error) { throw new HttpError(400, error instanceof Error ? error.message : "Invalid release or comparison windows."); }
      const measurement = await createReleaseMeasurement(workspace, input);
      return Response.json({ measurement });
    }
    if (action === "save_finding_note") {
      const findingId = rid.parse(body.id);
      const note = z.string().max(500).parse(body.note);
      const gameId = body.gameId === undefined ? undefined : rid.parse(body.gameId);
      const finding = await saveFindingNote(workspace, findingId, note, new Date(), gameId);
      return Response.json({ finding });
    }
    if (action === "update_finding") {
      const finding = await requireRecord<Finding>("finding", body.id);
      const status = z
        .enum(["open", "in_progress", "deferred", "dismissed", "resolved"])
        .parse(body.status);
      if (body.gameId !== undefined && body.gameId !== finding.gameId) throw new HttpError(404,"Finding not found for this game.");
      const note = z.string().trim().max(500).optional().parse(body.note);
      const deferredUntil = status === "deferred" ? z.string().datetime().parse(body.deferredUntil) : undefined;
      if (deferredUntil && (Date.parse(deferredUntil)<=Date.now()||Date.parse(deferredUntil)>Date.now()+366*86400000)) throw new HttpError(400,"Choose a defer date within the next year.");
      const updated = await setFindingDecision(workspace,finding.id,{status,...(note!==undefined?{note}:{}),...(deferredUntil?{deferredUntil}:{})});
      return Response.json({ ok: true, finding: updated });
    }
    throw new HttpError(400, "Unknown action.");
  } catch (e) {
    if (e instanceof z.ZodError || e instanceof SyntaxError)
      return Response.json(
        { error: "Some fields are invalid. Check the form and try again." },
        { status: 400 },
      );
    return apiError(e);
  }
}
