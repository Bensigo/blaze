import { withActiveGameWork } from "./active-game-work";
import { get, id, query } from "./db";
import { hash } from "./security";
import { analytics } from "./analytics";
import { gameMetadata } from "./metadata";
import { readGameManifest } from "./game-manifest";
import type { Game } from "./types";

export type ProfileOverrides = Partial<Record<"description" | "genre" | "audience" | "rules" | "controls", string>>;
type Metadata = Awaited<ReturnType<typeof gameMetadata>>;
type Fact = { key: string; label: string; value: string; evidence: { source: string; observedAt: string; url?: string; recordingId?: string; at?: number; sha256?: string; formatVersion?: number } };
type Profile = { id: string; gameId: string; lastRefresh: string; facts: Fact[]; prerequisites: string[]; researchRunId?: string; result: "partial" | "complete" | "failed" };
type JobBody = { gameId: string; appOrigin: string; runKey: string; metadata?: Metadata; metadataAt?: string };
const profileJobId = (workspace: string, gameId: string) => `profile_${hash(`${workspace}:${gameId}`)}`;

// One statement makes the game and its initial investigation all-or-nothing.
export async function createGameWithProfile(workspace: string, game: Game, metadata: Metadata, appOrigin: string) {
  const jobId = profileJobId(workspace, game.id);
  await query(`WITH created AS (INSERT INTO records(workspace_id,kind,id,body) VALUES($1,'game',$2,$3::jsonb) RETURNING id)
    INSERT INTO jobs(id,workspace_id,kind,state,body) SELECT $4,$1,'game_profile','queued',$5::jsonb FROM created`,
    [workspace, game.id, JSON.stringify(game), jobId, JSON.stringify({ gameId: game.id, appOrigin, runKey: id("profile"), metadata, metadataAt: new Date().toISOString() })]);
  return jobId;
}

export async function queueProfile(workspace: string, gameId: string, appOrigin: string) {
  const jobId = profileJobId(workspace, gameId);
  await withActiveGameWork(workspace, gameId, sql => sql(`INSERT INTO jobs(id,workspace_id,kind,state,body) VALUES($1,$2,'game_profile','queued',$3::jsonb) ON CONFLICT(id) DO UPDATE SET state='queued',body=excluded.body,available_at=now(),lease_until=NULL,updated_at=now() WHERE jobs.state IN ('complete','failed')`,
    [jobId, workspace, JSON.stringify({ gameId, appOrigin, runKey: id("profile") })]));
  return jobId;
}

// Accepted human data starts a refresh, coalesced across requests and limited to
// once per 24 hours. If an investigation is already running, it gets one follow-up.
export async function queueHumanProfileRefresh(workspace: string, gameId: string, appOrigin: string) {
  const game=await get<Game>(workspace,'game',gameId);
  if(!game?.dailyEnabled)return undefined;
  const jobId = profileJobId(workspace, gameId);
  const body = { gameId, appOrigin, runKey: id("profile") };
  const rows = await withActiveGameWork(workspace, gameId, sql => sql<{ id: string }>(`WITH due AS (
    INSERT INTO records(workspace_id,kind,id,body) VALUES($1,'profile_human_refresh',$2,jsonb_build_object('id',$2::text))
    ON CONFLICT(workspace_id,kind,id) DO UPDATE SET updated_at=now()
      WHERE records.updated_at<=now()-interval '24 hours' RETURNING id
  ) INSERT INTO jobs(id,workspace_id,kind,state,body)
    SELECT $3,$1,'game_profile','queued',$4::jsonb FROM due
    ON CONFLICT(id) DO UPDATE SET
      state=CASE WHEN jobs.state IN ('complete','failed') THEN 'queued' ELSE jobs.state END,
      body=CASE WHEN jobs.state='claimed' THEN jobs.body || '{"humanRefreshPending":true}'::jsonb
        WHEN jobs.state IN ('complete','failed') THEN excluded.body ELSE jobs.body END,
      available_at=CASE WHEN jobs.state IN ('complete','failed') THEN now() ELSE jobs.available_at END,
      updated_at=now() RETURNING id`, [workspace, gameId, jobId, JSON.stringify(body)]));
  return rows.length ? jobId : undefined;
}

export async function readProfile(workspace: string, gameId: string) {
  const [profile, overrideRecord, jobs] = await Promise.all([
    get<Profile>(workspace, "game_profile", gameId),
    get<{ id: string; overrides: ProfileOverrides }>(workspace, "game_profile_overrides", gameId),
    query<{ state: string; lease_until: Date | null }>(`SELECT state,lease_until FROM jobs WHERE workspace_id=$1 AND kind='game_profile' AND body->>'gameId'=$2 ORDER BY updated_at DESC LIMIT 1`, [workspace, gameId]),
  ]);
  const job = jobs[0];
  const status = job?.state === "queued" || (job?.state === "claimed" && job.lease_until && new Date(job.lease_until).getTime() < Date.now()) ? "queued" : job?.state === "claimed" ? "running" : job?.state === "failed" ? "failed" : profile?.result || "not_started";
  return { gameId, status, lastRefresh: profile?.lastRefresh || null, facts: profile?.facts || [], prerequisites: job?.state === "failed" ? ["Investigation failed. Retry the investigation.", ...(profile?.prerequisites || [])] : profile?.prerequisites || ["Investigation has not finished."], overrides: overrideRecord?.overrides || {}, researchRunId: profile?.researchRunId };
}

// Patch only the keys supplied; a separate row protects edits from investigation writes.
export async function updateProfileOverrides(workspace: string, gameId: string, patch: ProfileOverrides) {
  const set: ProfileOverrides = {};
  const remove: string[] = [];
  for (const [key, value] of Object.entries(patch)) value ? Object.assign(set, { [key]: value }) : remove.push(key);
  await query(`INSERT INTO records(workspace_id,kind,id,body) VALUES($1,'game_profile_overrides',$2,jsonb_build_object('id',$2::text,'overrides',$3::jsonb))
    ON CONFLICT(workspace_id,kind,id) DO UPDATE SET body=jsonb_set(records.body,'{overrides}',(coalesce(records.body->'overrides','{}'::jsonb) - $4::text[]) || $3::jsonb),updated_at=now()`,
    [workspace, gameId, JSON.stringify(set), remove]);
}

export async function drainProfile(jobId?: string) {
  const row = (await query<{ id: string; workspace_id: string; body: JobBody; lease_until: Date }>(
    `UPDATE jobs SET state='claimed',lease_until=now()+interval '10 minutes',updated_at=now() WHERE id=(SELECT id FROM jobs WHERE kind='game_profile' AND ($1::text IS NULL OR id=$1) AND available_at<=now() AND (state='queued' OR (state='claimed' AND lease_until<now())) ORDER BY available_at FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING id,workspace_id,body,lease_until`, [jobId || null]))[0];
  if (!row) return;
  const workspace = row.workspace_id;
  try {
    const game = await get<Game>(workspace, "game", row.body.gameId);
    if (!game) throw new Error("Game no longer exists");
    const now = new Date().toISOString();
    const facts: Fact[] = [];
    const prerequisites: string[] = [];
    let metadata = row.body.metadata;
    if (!metadata) {
      try { metadata = await gameMetadata(game.url, row.body.appOrigin); }
      catch (error) { prerequisites.push(error instanceof Error ? error.message : "The game manifest could not be retrieved safely."); }
    }
    if (metadata) {
      const evidence = metadata.manifestSource
        ? { source: metadata.metadataStatus === "Controlled fixture manifest" ? "Controlled fixture manifest" : "Forever game manifest", ...metadata.manifestSource }
        : { source: "Legacy public page metadata", url: metadata.url, observedAt: row.body.metadataAt || now };
      if (metadata.title && metadata.title !== new URL(metadata.url).hostname) facts.push({ key: "page_title", label: "Imported name", value: metadata.title, evidence });
      if (metadata.description) facts.push({ key: "page_description", label: "Imported description", value: metadata.description, evidence });
    }
    const manifest = await readGameManifest(game.url, row.body.appOrigin);
    if (manifest.status === "complete") {
      const evidence = { source: "Forever game manifest", ...manifest.source };
      const values: Array<[string, string, string]> = [
        ["manifest_id", "Manifest game ID (separate from Blaze ID)", manifest.facts.id],
        ["manifest_slug", "Manifest URL slug", manifest.facts.slug],
        ["manifest_name", "Manifest name", manifest.facts.name],
        ["manifest_description", "Manifest description", manifest.facts.description],
        ["manifest_genre", "Manifest genre", manifest.facts.genre],
        ["manifest_controls", "Manifest controls", manifest.facts.controls.label],
        ["manifest_rules", "Manifest how to play", manifest.facts.howToPlay.join(" ")],
        ...manifest.facts.about.map((value, i): [string, string, string] => [`manifest_about:${i}`, "Manifest about", value]),
        ...manifest.facts.faq.map((entry, i): [string, string, string] => [`manifest_faq:${i}`, "Manifest FAQ", `${entry.q} ${entry.a}`]),
      ];
      for (const [key, label, value] of values) facts.push({ key, label, value, evidence });
    } else if (manifest.status !== "not_applicable") prerequisites.push(`Forever game manifest: ${manifest.detail}`);
    const stats = await analytics(workspace, game.id, 30);
    if (stats.sessions) facts.push({ key: "human_sessions", label: "Human sessions, last 30 days", value: String(stats.sessions), evidence: { source: "Human telemetry", observedAt: now } });
    else prerequisites.push("No human telemetry was recorded in the last 30 days.");
    // Controls and rules remain unknown unless an owner supplies them or an observation supports them.
    const owner = await get<{ id: string; overrides: ProfileOverrides }>(workspace, "game_profile_overrides", game.id);
    if ((!owner?.overrides.rules || !owner?.overrides.controls) && manifest.status !== "complete") prerequisites.push("Rules and controls are unknown unless supported by gameplay evidence or entered by the owner.");
    const profile: Profile = { id: game.id, gameId: game.id, lastRefresh: new Date().toISOString(), facts, prerequisites, result: prerequisites.length ? "partial" : "complete" };
    await query(`WITH saved AS (INSERT INTO records(workspace_id,kind,id,body) SELECT $1,'game_profile',$2,$3::jsonb FROM jobs WHERE id=$4 AND state='claimed' AND lease_until=$5::timestamptz ON CONFLICT(workspace_id,kind,id) DO UPDATE SET body=excluded.body,updated_at=now() RETURNING id) UPDATE jobs SET state=CASE WHEN body->>'humanRefreshPending'='true' THEN 'queued' ELSE 'complete' END, body=CASE WHEN body->>'humanRefreshPending'='true' THEN (body-'humanRefreshPending'-'metadata'-'metadataAt') || jsonb_build_object('runKey',$6::text) ELSE body END, available_at=now(),lease_until=NULL,updated_at=now() WHERE id=$4 AND lease_until=$5::timestamptz AND EXISTS(SELECT 1 FROM saved)`, [workspace, game.id, JSON.stringify(profile), row.id, row.lease_until, id("profile")]);
  } catch {
    await query(`UPDATE jobs SET state=CASE WHEN body->>'humanRefreshPending'='true' THEN 'queued' ELSE 'failed' END, body=CASE WHEN body->>'humanRefreshPending'='true' THEN (body-'humanRefreshPending'-'metadata'-'metadataAt') || jsonb_build_object('runKey',$3::text) ELSE body END, available_at=now(),lease_until=NULL,updated_at=now() WHERE id=$1 AND state='claimed' AND lease_until=$2::timestamptz`, [row.id, row.lease_until, id("profile")]);
  }
}
