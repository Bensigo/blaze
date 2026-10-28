import type { SessionCapture } from "./types";
export function replayCoverage(captures: SessionCapture[], startedAt: string, lastAt: string) {
  const start = Date.parse(startedAt), end = Math.max(start, Date.parse(lastAt));
  const segments = captures.filter((c) => c.status === "ready" && c.videoUrl && c.recordedAt && c.durationSeconds && Date.parse(c.expiresAt) > Date.now())
    .map((c) => ({ captureId: c.id, startAt: c.recordedAt!, endAt: new Date(Date.parse(c.recordedAt!) + c.durationSeconds! * 1000).toISOString() }))
    .sort((a, b) => a.startAt.localeCompare(b.startAt));
  const gaps: { startAt: string; endAt: string; reason: string }[] = [];
  let cursor = start, recordedMilliseconds = 0;
  for (const segment of segments) {
    const lo = Math.max(start, Date.parse(segment.startAt)), hi = Math.min(end, Date.parse(segment.endAt));
    if (lo > cursor + 250) gaps.push({ startAt: new Date(cursor).toISOString(), endAt: new Date(Math.min(lo, end)).toISOString(), reason: "No saved recording covers this interval." });
    if (hi > Math.max(cursor, lo)) recordedMilliseconds += hi - Math.max(cursor, lo);
    cursor = Math.max(cursor, Math.min(end, hi));
  }
  if (end > cursor + 250) gaps.push({ startAt: new Date(cursor).toISOString(), endAt: new Date(end).toISOString(), reason: "No saved recording covers this interval; recording may have stopped, reached its limit, or failed to upload." });
  return { surface: "canvas" as const, startedAt, lastAt, segments, gaps, recordedSeconds: recordedMilliseconds / 1000, complete: false,
    limitation: "Sampled gameplay canvas only, up to four 30-second segments. Uploads, hidden tabs and exits can leave gaps. DOM-only games, audio and unrecorded intervals are not replayed." };
}
