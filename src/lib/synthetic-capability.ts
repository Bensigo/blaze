import { randomBytes } from "node:crypto";
import { query } from "./db";
import { hash } from "./security";

// Called only from the authenticated worker claim path after a recording was claimed.
export async function mintSyntheticCapability(workspace: string, recordingId: string, gameId: string, gameUrl: string): Promise<string> {
  const origin = new URL(gameUrl).origin;
  if (!origin.startsWith("https://")) throw new Error("Synthetic game origin must use HTTPS");
  await query(`DELETE FROM records WHERE workspace_id=$1 AND kind='synthetic_capability' AND (body->>'expiresAt')::timestamptz<=now()`, [workspace]);
  const capability = randomBytes(32).toString("base64url");
  const body = JSON.stringify({ gameId, recordingId, origin, expiresAt: new Date(Date.now() + 300_000).toISOString() });
  const inserted = await query(`INSERT INTO records(workspace_id,kind,id,body)
    SELECT $1,'synthetic_capability',$2,$3::jsonb WHERE EXISTS
      (SELECT 1 FROM jobs WHERE id=$4 AND workspace_id=$1 AND kind='recording' AND state='claimed' AND lease_until>now())
      AND EXISTS (SELECT 1 FROM records WHERE workspace_id=$1 AND kind='recording' AND id=$4 AND body->>'gameId'=$5)
      AND EXISTS (SELECT 1 FROM records WHERE workspace_id=$1 AND kind='game' AND id=$5 AND body->>'url'=$6)
    RETURNING id`, [workspace, hash(capability), body, recordingId, gameId, gameUrl]);
  if (!inserted.length) throw new Error("Recording lease is not active");
  return capability;
}

export async function verifySyntheticCapability(input: { capability: string; gameId: string; origin: string; guestSessionId: string }): Promise<boolean> {
  if (!/^[A-Za-z0-9_-]{43}$/.test(input.capability) || !/^[A-Za-z0-9_-]{1,200}$/.test(input.gameId) ||
      !/^[A-Za-z0-9_-]{1,200}$/.test(input.guestSessionId)) return false;
  try { if (new URL(input.origin).origin !== input.origin || !input.origin.startsWith("https://")) return false; } catch { return false; }
  // One atomic write binds the first successful guest, with idempotent re-verification.
  const rows = await query(`UPDATE records AS c SET body=jsonb_set(c.body,'{guestSessionId}',to_jsonb($4::text),true),updated_at=now()
    WHERE c.kind='synthetic_capability' AND c.id=$1 AND c.body->>'gameId'=$2 AND c.body->>'origin'=$3
      AND (c.body->>'expiresAt')::timestamptz>now() AND (c.body->>'guestSessionId' IS NULL OR c.body->>'guestSessionId'=$4)
      AND EXISTS (SELECT 1 FROM jobs j WHERE j.id=c.body->>'recordingId' AND j.workspace_id=c.workspace_id
        AND j.kind='recording' AND j.state='claimed' AND j.lease_until>now()) RETURNING c.id`,
    [hash(input.capability), input.gameId, input.origin, input.guestSessionId]);
  return rows.length === 1;
}
