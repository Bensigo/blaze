import { get, transaction, type TransactionQuery } from './db';
import { normalizeNetworkPolicy } from './network-policy';
import { hash } from './security';
import { HttpError } from './http-error';
import { readGameManifest } from './game-manifest';
import { gameMetadata } from './metadata';
import type { Game } from './types';
export const gameSourceVersion = (game: Game) => game.sourceUrlRevision || hash(game.url);
export function sourceUrl(input: string) {
  let u: URL; try { u = new URL(input.trim()); } catch { throw new HttpError(400, 'Enter the full public HTTPS game URL.'); }
  if (u.protocol !== 'https:' || u.username || u.password || u.search || u.hash || u.port || /[\\\s]/.test(input.trim())) throw new HttpError(400, 'Use a public HTTPS URL without credentials, query, fragment or custom port.');
  try { normalizeNetworkPolicy({resourceOrigins:[u.origin],webSocketOrigins:[]}); } catch { throw new HttpError(400,'Use a public HTTPS game host.'); }
  u.pathname = u.pathname.replace(/\/+$/, '') || '/'; return u.href;
}
export async function changeGameSource(workspace: string, gameId: string, input: string, expectedRevision: string, outerTransaction?: TransactionQuery) {
  const prior = outerTransaction?(await outerTransaction<{body:Game}>("SELECT body FROM records WHERE workspace_id=$1 AND kind='game' AND id=$2 FOR UPDATE",[workspace,gameId]))[0]?.body:await get<Game>(workspace, 'game', gameId);
  if (!prior) throw new HttpError(404, 'Active game not found.');
  if (gameSourceVersion(prior) !== expectedRevision) throw new HttpError(409, 'Source changed in another tab. Reload before saving.');
  const url = sourceUrl(input);
  if (url === prior.url) return prior;
  // Pinned public DNS, bounded body, no redirect following. No AI or worker run.
  const manifest = await readGameManifest(url);
  const metadata = manifest.status === 'complete' ? undefined : await gameMetadata(url, process.env.APP_URL || '');
  const apply=async (sql:TransactionQuery) => {
    const game = (await sql<{body: Game}>("SELECT body FROM records WHERE workspace_id=$1 AND kind='game' AND id=$2 FOR UPDATE", [workspace, gameId]))[0]?.body;
    if (!game) throw new HttpError(404, 'Active game not found.');
    if (gameSourceVersion(game) !== expectedRevision) throw new HttpError(409, 'Source changed in another tab. Reload before saving.');
    await sql("SELECT id FROM records WHERE workspace_id=$1 AND kind='post' AND body->>'gameId'=$2 FOR UPDATE",[workspace,gameId]);
    await sql("SELECT id FROM jobs WHERE workspace_id=$1 AND (body->>'gameId'=$2 OR body->>'postId' IN (SELECT id FROM records WHERE workspace_id=$1 AND kind='post' AND body->>'gameId'=$2)) FOR UPDATE", [workspace, gameId]);
    const claimed = await sql("SELECT id FROM jobs WHERE workspace_id=$1 AND (body->>'gameId'=$2 OR body->>'postId' IN (SELECT id FROM records WHERE workspace_id=$1 AND kind='post' AND body->>'gameId'=$2)) AND state='claimed' LIMIT 1", [workspace, gameId]);
    const active = await sql(`SELECT id FROM records WHERE workspace_id=$1 AND body->>'gameId'=$2 AND ((kind='video_production' AND body->>'state' IN ('starting','running','importing','cancel_requested','needs_reconciliation')) OR (kind='recording' AND body->>'status'='recording') OR (kind='idea_batch' AND body->>'state' IN ('starting','scoring','needs_reconciliation')) OR (kind='on_demand_content' AND body->>'state' IN ('starting','scoring','needs_reconciliation')) OR (kind='script_review' AND body->>'state' IN ('starting','needs_reconciliation')) OR (kind='post' AND body->>'status' IN ('uploading','processing'))) LIMIT 1`, [workspace, gameId]);
    if (claimed.length || active.length) throw new HttpError(409, 'This game has active or uncertain work. Stop or reconcile it before changing the source URL.');
    const stamp = new Date().toISOString();
    const next: Game = {...game, url, sourceUrlRevision: hash(`${gameSourceVersion(game)}:${url}:${stamp}`), dailyEnabled: false,
      manifestSource: manifest.status === 'complete' ? manifest.source : undefined, pageSource: metadata?.pageSource, metadataStatus: manifest.status === 'complete' ? 'Forever manifest' : 'Public page metadata',
      networkPolicy: {resourceOrigins: [], webSocketOrigins: [], frameUrls: []},
      ...(game.capture ? {capture: {...game.capture, enabled: false, surfaceReviewed: false}} : {})};
    await sql("UPDATE records SET body=$3::jsonb,updated_at=now() WHERE workspace_id=$1 AND kind='game' AND id=$2", [workspace, gameId, JSON.stringify(next)]);
    const profile = (await sql<{body: {facts?: unknown[]; [key:string]:unknown}}>("SELECT body FROM records WHERE workspace_id=$1 AND kind='game_profile' AND id=$2 FOR UPDATE", [workspace, gameId]))[0]?.body;
    const evidence = manifest.status === 'complete' ? {source: 'Forever game manifest', ...manifest.source} : {source: 'Public page metadata', ...metadata!.pageSource!};
    const fields: [string,string,string][] = manifest.status === 'complete' ? [
      ['manifest_name','Manifest name',manifest.facts.name], ['manifest_description','Manifest description',manifest.facts.description], ['manifest_genre','Manifest genre',manifest.facts.genre], ['manifest_controls','Manifest controls',manifest.facts.controls.label], ['manifest_rules','Manifest how to play',manifest.facts.howToPlay.join(' ')], ...manifest.facts.about.map((v,i):[string,string,string]=>[`manifest_about:${i}`,'Manifest about',v]), ...manifest.facts.faq.map((v,i):[string,string,string]=>[`manifest_faq:${i}`,'Manifest FAQ',`${v.q} ${v.a}`])
    ] : [['page_title','Imported name',metadata!.title], ...metadata!.description ? [['page_description','Imported description',metadata!.description] as [string,string,string]] : []];
    // The old profile snapshot remains history; only fresh public facts become current.
    if (profile) await sql("INSERT INTO records(workspace_id,kind,id,body) VALUES($1,'game_source_history',$2,$3::jsonb) ON CONFLICT DO NOTHING", [workspace, `${gameId}:${gameSourceVersion(game)}`, JSON.stringify({id:`${gameId}:${gameSourceVersion(game)}`,gameId,game,profile,changedAt:stamp})]);
    await sql("INSERT INTO records(workspace_id,kind,id,body) VALUES($1,'game_profile',$2,$3::jsonb) ON CONFLICT(workspace_id,kind,id) DO UPDATE SET body=excluded.body,updated_at=now()", [workspace,gameId,JSON.stringify({id:gameId,gameId,lastRefresh:stamp,facts:fields.map(([key,label,value])=>({key,label,value,evidence})),prerequisites:['Source URL changed. Review game settings and capture consent.'],result:'partial'})]);
    await sql("UPDATE jobs SET state='failed',body=body || '{\"error\":\"Game source URL changed; approve fresh work.\"}'::jsonb,updated_at=now() WHERE workspace_id=$1 AND (body->>'gameId'=$2 OR body->>'postId' IN (SELECT id FROM records WHERE workspace_id=$1 AND kind='post' AND body->>'gameId'=$2)) AND state='queued'",[workspace,gameId]);
    await sql("UPDATE records SET body=body || '{\"state\":\"failed\",\"error\":\"Game source URL changed; approval consumed.\"}'::jsonb,updated_at=now() WHERE workspace_id=$1 AND body->>'gameId'=$2 AND kind IN ('video_production','script_review','on_demand_content') AND body->>'state'='approved'",[workspace,gameId]);
    await sql("UPDATE records SET body=(body-'approvedHash'-'approvedAt'-'approvedBy') || '{\"status\":\"draft\",\"deliveryMethod\":\"manual\"}'::jsonb,updated_at=now() WHERE workspace_id=$1 AND kind='post' AND body->>'gameId'=$2 AND body->>'status' IN ('approved','scheduled')",[workspace,gameId]);
    await sql("UPDATE records SET body=body || '{\"state\":\"revoked\"}'::jsonb,updated_at=now() WHERE workspace_id=$1 AND kind='pilot_grant' AND body->>'gameId'=$2 AND body->>'state'='approved'",[workspace,gameId]);
    await sql("UPDATE records SET body=body || '{\"enabled\":false}'::jsonb,updated_at=now() WHERE workspace_id=$1 AND kind='game_automation' AND id=$2",[workspace,gameId]);
    return next;
  };
  return outerTransaction?apply(outerTransaction):transaction(apply);
}
