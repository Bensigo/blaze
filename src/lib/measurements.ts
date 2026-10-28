import { get, id, put, query } from "./db";
import { measurementMetrics, validateMeasurementWindows } from "./measurement-outcomes";
import type { Finding, Measurement, MeasurementMetrics, MeasurementRelease, MeasurementWindow } from "./types";

const DAY = 86400000;
export interface ReleaseMeasurementInput {
  findingId: string; gameId: string; note: string; release: MeasurementRelease;
  baselineWindow: MeasurementWindow; followupWindow: MeasurementWindow;
}

/** Records an owner-reported shipped release against an existing same-game finding. */
export async function createReleaseMeasurement(workspace: string, input: ReleaseMeasurementInput, now = Date.now()) {
  if (!input || typeof input.gameId !== "string" || typeof input.findingId !== "string" || typeof input.note !== "string" || input.note.trim().length < 3 || input.note.length > 500) throw new Error("Finding, game and a short note are required");
  validateMeasurementWindows(input.release, input.baselineWindow, input.followupWindow, now);
  const finding = await get<Finding>(workspace, "finding", input.findingId);
  if (!finding || finding.gameId !== input.gameId) throw new Error("Finding not found for this game");
  const b = await measurementMetrics(workspace, input.gameId, input.baselineWindow.start, input.baselineWindow.end, new Date(now).toISOString());
  const measurement: Measurement = {
    id: id("measure"), gameId: input.gameId, findingId: finding.id, note: input.note.trim(), startedAt: input.release.effectiveAt,
    release: { ...input.release }, baselineWindow: { ...input.baselineWindow }, followupWindow: { ...input.followupWindow },
    baseline: counts(b), after: { sessions: 0, starts: 0, completions: 0, errorSessions: 0 }, daysObserved: 0,
  };
  await put(workspace, "measurement", measurement);
  return measurement;
}
function counts(m: MeasurementMetrics) { return {sessions:m.sessions, starts:m.starts, completions:m.completions, errorSessions:m.errorSessions}; }
function mixDiff(a: {name:string;count:number}[], b: {name:string;count:number}[], n: number, m: number) {
  if (!n || !m) return false;
  const names = new Set([...a.map(x=>x.name),...b.map(x=>x.name)]);
  return [...names].some(name => Math.abs((a.find(x=>x.name===name)?.count || 0)/n-(b.find(x=>x.name===name)?.count || 0)/m) >= 0.2);
}
export async function measurementResults(workspace: string, gameId?: string, now = Date.now(), options: { limit?: number; updatedSince?: string } = {}) {
  const limit = Math.min(100, Math.max(1, Math.floor(options.limit || 100)));
  const measurements = (await query<{ body: Measurement }>(`SELECT body FROM records
    WHERE workspace_id=$1 AND kind='measurement' AND ($2::text IS NULL OR body->>'gameId'=$2)
      AND ($3::timestamptz IS NULL OR updated_at >= $3::timestamptz)
    ORDER BY updated_at DESC,id DESC LIMIT $4`, [workspace,gameId || null,options.updatedSince || null,limit])).map(row => row.body);
  return Promise.all(measurements.map(async m => {
    if (!m.release || !m.baselineWindow || !m.followupWindow) {
      // Historical button clicks did not establish that a change actually shipped.
      const start = Date.parse(m.startedAt), end = Math.min(now, start + 14*DAY);
      if (!Number.isFinite(start)) return { ...m, releaseContextStatus: "missing" as const };
      const a = await measurementMetrics(workspace,m.gameId,new Date(start).toISOString(),new Date(Math.max(start,end)).toISOString(),new Date(now).toISOString());
      return {...m, after:counts(a), daysObserved:Math.max(0,(end-start)/DAY), releaseContextStatus:"missing" as const};
    }
    let bounds: ReturnType<typeof validateMeasurementWindows>;
    try {
      bounds = validateMeasurementWindows(m.release,m.baselineWindow,m.followupWindow,now);
      const finding = await get<Finding>(workspace,"finding",m.findingId);
      if (!finding || finding.gameId !== m.gameId) throw new Error("Invalid finding link");
    } catch { return {...m, releaseContextStatus:"invalid" as const}; }
    const observedEnd = Math.max(bounds.fs, Math.min(bounds.fe,now));
    const asOf = new Date(now).toISOString();
    const [baseline,followup] = await Promise.all([
      measurementMetrics(workspace,m.gameId,m.baselineWindow.start,m.baselineWindow.end,asOf),
      measurementMetrics(workspace,m.gameId,m.followupWindow.start,new Date(observedEnd).toISOString(),asOf),
    ]);
    const mature = now >= bounds.fe;
    const caveats:string[] = ["Observational comparison; it cannot establish that the release caused a change.", "Sessions and events are counted within each half-open UTC window; sessions crossing a boundary can appear in both.", "D1 uses first-seen players in the window and requires 48 hours of maturity; later return events are observed through the current evaluation time.", "Late-arriving events can change these results on later reviews.", `Overlap checks cover at most the latest ${limit} recorded comparisons in this view; unrecorded changes and other releases may overlap.`];
    if (!mature) caveats.push("Follow-up window is still in progress; its end is planned, not observed.");
    if (bounds.be-bounds.bs !== bounds.fe-bounds.fs) caveats.push("Planned windows have unequal duration; raw counts are not directly comparable.");
    if (baseline.sessions < 30 || followup.sessions < 30) caveats.push("Low session counts make comparisons unstable.");
    if ([baseline,followup].some(x=>x.activePlay.eligibleSessions > x.activePlay.measuredSessions || !x.conversion.denominator || !x.completion.denominator)) caveats.push("Instrumentation or denominators are incomplete; active-play coverage and rates may be unavailable or biased.");
    if (baseline.d1.eligible < baseline.d1.cohortPlayers || followup.d1.eligible < followup.d1.cohortPlayers) caveats.push("Some D1 cohorts are not mature.");
    if (mixDiff(baseline.sources,followup.sources,baseline.sessions,followup.sessions) || mixDiff(baseline.devices,followup.devices,baseline.sessions,followup.sessions)) caveats.push("Source or device mix differs by at least 20 percentage points for a reported category.");
    if (measurements.some(other=>other.id!==m.id && other.gameId===m.gameId && other.release && Number.isFinite(Date.parse(other.release.effectiveAt)) && Date.parse(other.release.effectiveAt)>=bounds.bs && Date.parse(other.release.effectiveAt)<bounds.fe)) caveats.push("Another recorded release overlaps the comparison period.");
    const candidates = (["conversion", "completion", "d1"] as const).flatMap(key => {
      const before = baseline[key], after = followup[key];
      const minimum = key === "d1" ? Math.min(baseline.d1.eligible, followup.d1.eligible) : Math.min(baseline[key].denominator, followup[key].denominator);
      return before.rate !== null && after.rate !== null && minimum >= 30 && after.rate - before.rate <= -0.1
        ? [{ key, difference: after.rate - before.rate }] : [];
    }).sort((a,b) => a.difference-b.difference);
    const nextAction = !mature ? "Wait until the planned follow-up ends, then review the same metrics and coverage." : baseline.sessions < 30 || followup.sessions < 30 ? "Collect more human sessions before interpreting the comparison; review the underlying finding in the meantime." : caveats.some(x=>x.startsWith("Instrumentation")) ? "Check event instrumentation and active-play coverage before interpreting the comparison." : candidates.length ? `Investigate the ${candidates[0].key} rate, which is ${Math.round(-100*candidates[0].difference)} percentage points lower in the follow-up; review denominators and traffic mix before choosing another change.` : "Review the finding and compare the reported rates, cohort maturity and traffic mix; decide whether to investigate or run a further controlled change.";
    return {...m, baseline:counts(baseline),after:counts(followup),daysObserved:Math.max(0,(observedEnd-bounds.fs)/DAY),releaseContextStatus:"recorded" as const,outcome:{baseline,followup,observedFollowupEnd:now < bounds.fs ? null : new Date(observedEnd).toISOString(),mature,releaseEvidence:"owner_reported" as const,caveats,nextAction}};
  }));
}
