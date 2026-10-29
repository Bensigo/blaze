import type { Finding, Game, Measurement, Recording } from './types';

export interface ActionItem {
  id: string;
  gameId: string;
  title: string;
  observation: string;
  suggestion: string;
  reason: string;
  impactHypothesis: string;
  priority: Finding['priority'];
  effort: 'small' | 'medium' | 'large' | 'unknown';
  whyNow: string;
  checkMetric: string;
  recordedAt?: string;
  status: Finding['status'];
  deferredUntil?: string;
  decisionNote?: string;
  evidence: Finding['evidence'];
  measurements: Measurement[];
}

const text = (value: unknown, limit = 600): string => typeof value === 'string' ? value.trim().slice(0, limit) : '';
const date = (value: unknown): string | undefined => typeof value === 'string' && value.trim() && Number.isFinite(Date.parse(value)) ? value.trim() : undefined;

/** Keep relative application paths and credential-free HTTP(S) links only. */
function safeUrl(value: unknown): string | undefined {
  const url = text(value, 2048);
  if (!url || /[\u0000-\u001f\u007f\\]/.test(url)) return undefined;
  if (url.startsWith('/') && !url.startsWith('//')) return url;
  try {
    const parsed = new URL(url);
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:') && !parsed.username && !parsed.password ? url : undefined;
  } catch { return undefined; }
}

const trace = /^Trace v1: (jev|forced|fixture) selected ([a-zA-Z0-9_-]{1,40}); phase (ready|playing|won|complete|completed|lost|paused|failed|gameover|game_over|unclassified) -> (ready|playing|won|complete|completed|lost|paused|failed|gameover|game_over|unclassified|action_or_run_failed|result_unobserved)\.$/;

/** Project existing evidence into a review action; no new fact or state is stored. */
export function toActionItem(finding: Finding, measurements: Measurement[] = [], recordings: Recording[] = [], games: Game[] = []): ActionItem {
  const evidence = (finding.evidence || []).slice(0, 20).map(item => ({
    label: text(item.label, 200) || 'Evidence',
    ...(safeUrl(item.url) ? { url: safeUrl(item.url) } : {}),
    ...(text(item.recordingId, 200) ? { recordingId: text(item.recordingId, 200) } : {}),
    ...(typeof item.at === 'number' && Number.isFinite(item.at) && item.at >= 0 ? { at: item.at } : {}),
  }));
  let traced = false;
  let observation = text(finding.detail) || 'No observation details recorded.';
  let suggestion = text(finding.action?.suggestion) || 'Review the evidence and try to reproduce the observation before changing the game.';
  const feedback = (finding as Finding & { feedback?: { relevance?: string; verification?: string } }).feedback;
  const isX = feedback?.verification === 'reported_not_reproduced' || /^X: /i.test(finding.title || '');
  if (isX) observation = `Reported on X; not verified. ${feedback?.relevance === 'possible' ? 'Possible game relevance; verify context. ' : ''}${observation}`.slice(0, 800);

  // Match the referenced recording and timestamp, not arbitrary model or game text.
  for (const item of evidence) {
    const recording = recordings.find(r => r.id === item.recordingId && r.gameId === finding.gameId);
    if (!recording || item.at === undefined) continue;
    const note = recording.observations?.find(n => n.at === item.at && n.type === 'observation' && trace.test(n.text));
    const match = note && trace.exec(note.text);
    if (!match || (recording.mode === 'fixture') !== (match[1] === 'fixture')) continue;
    traced = true;
    const game = games.find(g => g.id === finding.gameId);
    const context = game ? ` for ${text(game.title, 120)}` : '';
    const label = recording.targetProvenance === 'controlled_lab' ? 'Controlled decision lab with Jev runtime, not real-game acceptance' : recording.mode === 'fixture' ? 'Controlled fixture, not live Jev' : 'Synthetic playthrough, not human feedback';
    observation = `${label}${context}; one observation, not a confirmed bug. Selected ${match[2]}: ${match[3]} → ${match[4]}.`;
    suggestion = `Review the recording and reproduce: select ${match[2]} from phase ${match[3]} and check the resulting phase ${match[4]}. ${text(finding.action?.suggestion)}`.trim().slice(0, 800);
    break;
  }
  const related = measurements.filter(m => m.gameId === finding.gameId && m.findingId === finding.id).map(m => ({
    ...m,
    note: text(m.note),
    ...(m.release ? { release: { ...m.release, description: text(m.release.description), evidenceUrl: safeUrl(m.release.evidenceUrl) || '' } } : {}),
  }));
  return {
    id: finding.id, gameId: finding.gameId,
    title: text(finding.title, 200) || 'Review finding', observation, suggestion,
    reason: text(finding.action?.reason) || (traced ? 'The recording links an allowed input to an observed phase. Reproduce it before classifying a failure.' : 'Review the recorded evidence before drawing a conclusion.'),
    impactHypothesis: text(finding.action?.impactHypothesis) || (traced ? 'If this outcome is unintended and repeatable, correcting it may prevent interrupted rounds. Human impact is unmeasured.' : 'Impact unknown.'),
    priority: finding.priority, effort: finding.action?.effort || 'unknown',
    whyNow: text(finding.action?.whyNow) || (traced ? 'A timestamped recording provides a specific input and phase to replay on the same build.' : evidence.length ? 'Evidence is available for review.' : 'Review when supporting evidence is available.'),
    checkMetric: text(finding.action?.checkMetric) || (traced ? 'Reproduction attempts and repeated failures for the same game build and input; human completion rate remains unmeasured.' : 'Choose a relevant outcome metric before changing the game.'),
    recordedAt: date(finding.action?.observedAt) || date(finding.createdAt),
    status: finding.status, deferredUntil: date(finding.deferredUntil), decisionNote: text(finding.decisionNote) || undefined,
    evidence, measurements: related,
  };
}
