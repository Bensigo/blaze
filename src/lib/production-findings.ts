import { z } from "zod";
import { transaction, type TransactionQuery } from "./db";
import { hash } from "./security";
import { HttpError } from "./http-error";
import type { VideoProduction } from "./content-studio-contract";
import type { MediaRecord } from "./media";
import type { Finding } from "./types";

const safeText = (max: number) => z.string().trim().min(1).max(max).refine(value => !/(?:https?:\/\/|www\.)/i.test(value), "Do not include agent-provided URLs.");
export const productionObservationSchema = z.object({
  at: z.number().finite().nonnegative(),
  kind: z.enum(["observed_error", "performance_measurement", "ux_suggestion"]),
  title: safeText(160), detail: safeText(600),
  measurement: z.object({ metric: z.enum(["fps", "frame_time_ms"]), value: z.number().finite().nonnegative() }).strict().optional(),
  capturedInVideo: z.boolean(),
}).strict();
export const productionObservationsSchema = z.array(productionObservationSchema).max(20);
export type ProductionObservation = z.infer<typeof productionObservationSchema>;

/** Store only timestamped agent reports tied to an owned, ready production's verified media record. */
export async function persistProductionFindings(workspace: string, productionId: string, input: unknown, existingTransaction?:TransactionQuery) {
  const observations = productionObservationsSchema.parse(input);
  const persist=async (sql:TransactionQuery) => {
    const production = (await sql<{body:VideoProduction}>(`SELECT body FROM records WHERE workspace_id=$1 AND kind='video_production' AND id=$2 FOR UPDATE`, [workspace,productionId]))[0]?.body;
    if (!production || production.state !== "ready" || !production.videoUrl || !Number.isFinite(production.settings?.durationSeconds) || production.settings.durationSeconds <= 0) throw new HttpError(409, "A ready production with owned video is required for findings.");
    const mediaId = /^\/api\/media\/(media_[a-z0-9]+)$/.exec(production.videoUrl)?.[1];
    const media = mediaId && (await sql<{body:MediaRecord}>(`SELECT body FROM records WHERE workspace_id=$1 AND kind='media' AND id=$2`, [workspace,mediaId]))[0]?.body;
    if (!media || media.recordingId !== production.id || media.kind !== "clip" || media.contentType !== "video/mp4" || media.deletedAt || (media.expiresAt && Date.parse(media.expiresAt) <= Date.now())) throw new HttpError(409, "Production video media is unavailable.");
    let inserted = 0;
    for (const observation of observations) {
      if (!observation.capturedInVideo || observation.at > production.settings.durationSeconds + 1) continue;
      const id = `finding_${hash(JSON.stringify([production.id, observation])).slice(0,32)}`;
      const timestamp = new Date().toISOString();
      const measurement = observation.measurement ? ` Agent-reported ${observation.measurement.metric}: ${observation.measurement.value}.` : "";
      const finding: Finding = { id, gameId: production.gameId, title: observation.title, detail: `Agent reported; not verified by a human. ${observation.detail}${measurement}`, type: observation.kind === "ux_suggestion" ? "hypothesis" : "observation", priority: observation.kind === "ux_suggestion" ? "low" : "medium", status: "open", evidence: [{ label: "Agent-reported video moment; verify against footage", url: `${production.videoUrl}#t=${observation.at}`, at: observation.at }], createdAt: timestamp, action: { suggestion: "Review the video moment and reproduce or validate this report.", reason: "Agent-reported observation; not verified by a human.", impactHypothesis: "Potential improvement; impact is unverified.", effort: "unknown", whyNow: "A timestamped video is available for review.", checkMetric: observation.measurement?.metric || "Reproduce and review", observedAt: timestamp } };
      const rows = await sql(`INSERT INTO records(workspace_id,kind,id,body) VALUES($1,'finding',$2,$3::jsonb) ON CONFLICT(workspace_id,kind,id) DO NOTHING RETURNING id`, [workspace,id,JSON.stringify(finding)]);
      inserted += rows.length;
    }
    return { inserted };
  };
  return existingTransaction ? persist(existingTransaction) : transaction(persist);
}
