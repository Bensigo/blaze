import { query } from "./db";
import type { Analytics, SessionSummary } from "./types";
export interface EventRow {
  id: string;
  game_id: string;
  session_id: string;
  player_id: string;
  kind: "human" | "agent";
  name: string;
  occurred_at: string | Date;
  country: string;
  device: string;
  source: string;
  campaign: string;
  page: string;
  properties: Record<string, unknown>;
}
const date = (x: string | Date) => new Date(x).toISOString();
const day = (x: string | Date) => date(x).slice(0, 10);
const countBy = (items: string[]) =>
  Object.entries(
    items.reduce<Record<string, number>>((a, k) => {
      a[k || "Unknown"] = (a[k || "Unknown"] || 0) + 1;
      return a;
    }, {}),
  )
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);
export function summarize(
  events: EventRow[],
  firstSeen: Map<string, number>,
  days = 14,
  now = Date.now(),
  firstSessions?: Map<string, string>,
): Analytics {
  const originalSession =
    firstSessions ||
    new Map(
      [...events]
        .filter((e) => e.kind === "human")
        .sort(
          (a, b) =>
            new Date(a.occurred_at).getTime() -
            new Date(b.occurred_at).getTime(),
        )
        .reverse()
        .map((e) => [e.player_id, e.session_id]),
    );
  const cutoff = now - days * 86400000;
  const groups = new Map<string, EventRow[]>();
  for (const e of events) {
    if (e.kind !== "human" || new Date(e.occurred_at).getTime() < cutoff)
      continue;
    const key = `${e.game_id}:${e.session_id}`;
    const a = groups.get(key) || [];
    a.push(e);
    groups.set(key, a);
  }
  const sessions: SessionSummary[] = [];
  const orderedFunnel = [0, 0, 0, 0, 0];
  let replays = 0;
  const heat = new Map<
    string,
    { x: number; y: number; count: number; gameId: string }
  >();
  for (const ev of groups.values()) {
    ev.sort(
      (a, b) =>
        new Date(a.occurred_at).getTime() - new Date(b.occurred_at).getTime(),
    );
    const first = ev[0],
      last = ev.at(-1)!;
    const names = ev.map((e) => e.name);
    let from = 0;
    for (const [i, name] of [
      "visit",
      "loaded",
      "first_action",
      "round_start",
      "round_complete",
    ].entries()) {
      const idx = names.indexOf(name, from);
      if (idx < 0) break;
      orderedFunnel[i]++;
      from = idx + 1;
    }
    replays += names.filter((x) => x === "retry").length;
    const step = [...ev].reverse().find((e) => e.name === "progression")
      ?.properties.step;
    sessions.push({
      id: first.session_id,
      gameId: first.game_id,
      playerId: first.player_id,
      kind: "human",
      country: first.country,
      device: first.device,
      source: first.source,
      campaign: first.campaign,
      startedAt: date(first.occurred_at),
      lastAt: date(last.occurred_at),
      events: ev.length,
      completed: names.includes("round_complete"),
      lastStep:
        typeof step === "string"
          ? step
          : [...ev].reverse().find((e) => !["pointer", "exit"].includes(e.name))
              ?.name || "visit",
      errors: names.filter((x) => x === "error").length,
      duration: Math.max(
        0,
        (new Date(last.occurred_at).getTime() -
          new Date(first.occurred_at).getTime()) /
          1000,
      ),
    });
    for (const e of ev)
      if (
        e.name === "pointer" &&
        typeof e.properties.x === "number" &&
        typeof e.properties.y === "number"
      ) {
        const x =
            Math.floor(Math.max(0, Math.min(0.999, e.properties.x)) * 20) / 20 +
            0.025,
          y =
            Math.floor(Math.max(0, Math.min(0.999, e.properties.y)) * 20) / 20 +
            0.025;
        const key = `${e.game_id}:${x}:${y}`,
          v = heat.get(key) || { x, y, count: 0, gameId: e.game_id };
        v.count++;
        heat.set(key, v);
      }
  }
  const players = new Set(sessions.map((s) => s.playerId));
  const returned = new Set(
    sessions
      .filter(
        (s) =>
          s.id !== originalSession.get(s.playerId) &&
          new Date(s.startedAt).getTime() -
            (firstSeen.get(s.playerId) || new Date(s.startedAt).getTime()) >=
            86400000,
      )
      .map((s) => s.playerId),
  );
  const trend = Array.from({ length: days }, (_, i) => ({
    date: new Date(now - (days - 1 - i) * 86400000).toISOString().slice(0, 10),
    visits: 0,
    starts: 0,
    completions: 0,
  }));
  for (const s of sessions) {
    const row = trend.find((r) => r.date === day(s.startedAt));
    if (row) {
      row.visits++;
      const ev = groups.get(`${s.gameId}:${s.id}`)!;
      if (ev.some((e) => e.name === "round_start")) row.starts++;
      if (s.completed) row.completions++;
    }
  }
  const retention: Analytics["retention"] = [];
  for (const row of trend) {
    const cohort = [...firstSeen].filter(
      ([, t]) => day(new Date(t)) === row.date,
    );
    const mature = cohort.filter(([, t]) => now - t >= 48 * 3600000);
    const cameBack = mature.filter(([p, t]) =>
      events.some(
        (e) =>
          e.kind === "human" &&
          e.name === "visit" &&
          e.player_id === p &&
          e.session_id !== originalSession.get(p) &&
          new Date(e.occurred_at).getTime() >= t + 86400000 &&
          new Date(e.occurred_at).getTime() < t + 2 * 86400000,
      ),
    );
    retention.push({
      date: row.date,
      players: cohort.length,
      eligible: mature.length,
      returned: cameBack.length,
      rate: mature.length ? cameBack.length / mature.length : null,
    });
  }
  const campaigns = countBy(
    sessions.filter((s) => !!s.campaign).map((s) => s.campaign),
  ).map(({ name }) => {
    const a = sessions.filter((s) => s.campaign === name);
    return {
      name,
      visits: a.length,
      starts: a.filter((s) =>
        groups
          .get(`${s.gameId}:${s.id}`)!
          .some((e) => e.name === "round_start"),
      ).length,
      completions: a.filter((s) => s.completed).length,
      returns: new Set(
        a.filter((s) => returned.has(s.playerId)).map((s) => s.playerId),
      ).size,
    };
  });
  const human = events.filter(
    (e) => e.kind === "human" && new Date(e.occurred_at).getTime() >= cutoff,
  );
  return {
    sessions: sessions.length,
    players: players.size,
    starts: sessions.filter((s) =>
      groups.get(`${s.gameId}:${s.id}`)!.some((e) => e.name === "round_start"),
    ).length,
    completions: sessions.filter((s) => s.completed).length,
    replays,
    returns: returned.size,
    errorSessions: sessions.filter((s) => s.errors > 0).length,
    firstActions: sessions.filter((s) =>
      groups.get(`${s.gameId}:${s.id}`)!.some((e) => e.name === "first_action"),
    ).length,
    lastEventAt: human.length
      ? date(
          human.reduce((a, b) =>
            new Date(a.occurred_at) > new Date(b.occurred_at) ? a : b,
          ).occurred_at,
        )
      : null,
    trend,
    funnel: [
      "Visit",
      "Loaded",
      "First action",
      "Round started",
      "Round completed",
    ].map((name, i) => ({ name, count: orderedFunnel[i] })),
    countries: countBy(sessions.map((s) => s.country)),
    sources: countBy(sessions.map((s) => s.source)),
    devices: countBy(sessions.map((s) => s.device)),
    dropoffs: countBy(
      sessions.filter((s) => !s.completed).map((s) => s.lastStep),
    ),
    retention,
    campaigns,
    sessionsList: sessions.sort((a, b) =>
      b.startedAt.localeCompare(a.startedAt),
    ),
    heatmap: [...heat.values()],
    syntheticSessions: new Set(
      events.filter((e) => e.kind === "agent").map((e) => e.session_id),
    ).size,
  };
}
export async function analytics(workspace: string, gameId?: string, days = 14) {
  const filters = gameId ? " AND game_id=$2" : "";
  const params = gameId ? [workspace, gameId] : [workspace];
  const events = await query<EventRow>(
    `SELECT * FROM events WHERE workspace_id=$1${filters} AND occurred_at>now()-interval '90 days' ORDER BY occurred_at`,
    params,
  );
  const first = await query<{
    player_id: string;
    first_at: Date;
    session_id: string;
  }>(
    `SELECT DISTINCT ON (player_id) player_id,occurred_at AS first_at,session_id FROM events WHERE workspace_id=$1${filters} AND kind='human' ORDER BY player_id,occurred_at`,
    params,
  );
  return summarize(
    events,
    new Map(first.map((x) => [x.player_id, new Date(x.first_at).getTime()])),
    days,
    Date.now(),
    new Map(first.map((x) => [x.player_id, x.session_id])),
  );
}
