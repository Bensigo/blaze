import { sqlAnalytics } from "./analytics-sql";
export { querySessionPage } from "./analytics-sql";
import type { Analytics, SessionSummary, Game } from "./types";
export interface EventRow {
  id: string;
  game_id: string;
  session_id: string;
  player_id: string;
  kind: "human" | "agent";
  name: string;
  occurred_at: string | Date;
  received_at?: string | Date;
  country: string;
  device: string;
  source: string;
  campaign: string;
  page: string;
  properties: Record<string, unknown>;
}
const date = (x: string | Date) => new Date(x).toISOString();
const day = (x: string | Date) => date(x).slice(0, 10);
/** Caller supplies only events and games owned by one workspace. */
export function summarizeMostPlayed(events: EventRow[], games: Game[], days = 14, now = Date.now(), gameId?: string) {
  if (!Number.isInteger(days) || days < 1 || days > 90 || !Number.isFinite(now)) throw new Error("Invalid analytics window");
  const eligible = new Set(games.filter(g => (!gameId || g.id === gameId) && g.metadataStatus !== "Controlled fixture manifest" && !/(^|\/)fixture\/index[.]html\/?([?#]|$)/i.test(g.url)).map(g => g.id));
  const groups = new Map<string, EventRow[]>();
  for (const e of events) {
    const at = new Date(e.occurred_at).getTime(), received = e.received_at === undefined ? at : new Date(e.received_at).getTime();
    if (!eligible.has(e.game_id) || !Number.isFinite(at) || !Number.isFinite(received) || at < now-days*86400000 || at > now || received > now) continue;
    const key = JSON.stringify([e.game_id,e.session_id]), group = groups.get(key) || [];
    group.push(e); groups.set(key,group);
  }
  const byGame = new Map<string,{gameId:string; ids:Set<string>; playedSessions:number; roundStarts:number; activeSeconds:number|null; measuredSessions:number}>();
  for (const group of groups.values()) {
    if (group.some(e=>e.kind==='agent' || e.properties.test===true || e.properties.fixture===true || e.properties.isTest===true || e.properties.isFixture===true || e.properties.traffic==='test' || e.properties.traffic==='fixture')) continue;
    const human=group.filter(e=>e.kind==='human').sort((a,b)=>new Date(a.occurred_at).getTime()-new Date(b.occurred_at).getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const starts=human.filter(e=>e.name==='round_start').length;
    if (!starts) continue;
    const game=human[0].game_id, row=byGame.get(game) || {gameId:game,ids:new Set<string>(),playedSessions:0,roundStarts:0,activeSeconds:null,measuredSessions:0};
    row.ids.add(human[0].player_id); row.playedSessions++; row.roundStarts+=starts;
    let active: number | null = null, running=false;
    for (const e of human) {
      if (e.name==='round_start') running=true;
      else if (e.name==='round_complete' || e.name==='exit') running=false;
      else if (e.name==='active_play' && running && typeof e.properties.duration==='number' && Number.isFinite(e.properties.duration)) active=(active??0)+Math.max(0,Math.min(15,e.properties.duration));
    }
    if (active!==null) {row.activeSeconds=(row.activeSeconds??0)+active;row.measuredSessions++;}
    byGame.set(game,row);
  }
  return [...byGame.values()].map(({ids,...row})=>({...row,browserIds:ids.size})).sort((a,b)=>b.browserIds-a.browserIds||b.playedSessions-a.playedSessions||b.roundStarts-a.roundStarts||(a.gameId<b.gameId?-1:a.gameId>b.gameId?1:0));
}
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
  games: Game[] = [],
): Analytics {
  const excludedSessions=new Set(events.filter(e=>e.kind==='agent'||e.properties.test===true||e.properties.fixture===true||e.properties.isTest===true||e.properties.isFixture===true||e.properties.traffic==='test'||e.properties.traffic==='fixture').map(e=>JSON.stringify([e.game_id,e.session_id])));
  events=events.filter(e=>e.kind==='agent'||!excludedSessions.has(JSON.stringify([e.game_id,e.session_id])));
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
    Analytics["heatmap"][number]
  >();
  for (const ev of groups.values()) {
    ev.sort(
      (a, b) =>
        new Date(a.occurred_at).getTime() - new Date(b.occurred_at).getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    );
    const first = ev[0],
      last = ev.at(-1)!;
    const names = ev.map((e) => e.name);
    const visit = names.indexOf("visit");
    const loaded = visit >= 0 ? names.indexOf("loaded", visit + 1) : -1;
    const start = loaded >= 0 ? names.indexOf("round_start", loaded + 1) : -1;
    // Games differ: the first accepted action can precede or follow round_start.
    const action = visit >= 0 ? names.indexOf("first_action", visit + 1) : -1;
    const completed = start >= 0 && action >= 0 ? names.indexOf("round_complete", Math.max(start, action) + 1) : -1;
    if (visit >= 0) orderedFunnel[0]++;
    if (loaded >= 0) orderedFunnel[1]++;
    if (start >= 0) orderedFunnel[2]++;
    if (start >= 0 && action >= 0) orderedFunnel[3]++;
    if (completed >= 0) orderedFunnel[4]++;
    replays += names.filter((x) => x === "retry").length;
    const step = [...ev].reverse().find((e) => e.name === "progression")
      ?.properties.step;
    let running = false, activePlaySeconds: number | null = null;
    for (const event of ev) {
      if (event.name === "round_start") running = true;
      else if (event.name === "round_complete" || event.name === "exit") running = false;
      else if (event.name === "active_play" && running && typeof event.properties.duration === "number" && Number.isFinite(event.properties.duration))
        activePlaySeconds = (activePlaySeconds ?? 0) + Math.max(0, Math.min(15, event.properties.duration));
    }
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
          : [...ev].reverse().find((e) => !["pointer", "exit", "active_play"].includes(e.name))
              ?.name || "Unknown",
      errors: names.filter((x) => x === "error").length,
      activePlaySeconds,
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
        typeof e.properties.x === "number" && Number.isFinite(e.properties.x) && e.properties.x >= 0 && e.properties.x <= 1 &&
        typeof e.properties.y === "number" && Number.isFinite(e.properties.y) && e.properties.y >= 0 && e.properties.y <= 1
      ) {
        const legacy = e.properties.surface === undefined && e.properties.screen === undefined;
        const surface = legacy ? "viewport" : e.properties.surface;
        const screen = legacy ? "unknown" : e.properties.screen;
        if ((surface !== "game" && surface !== "viewport") || typeof screen !== "string" || !/^[A-Za-z0-9_-]{1,40}$/.test(screen)) continue;
        const device = ["mobile", "tablet", "desktop"].includes(e.device) ? e.device : "Unknown";
        const bx = Math.min(19, Math.floor(e.properties.x * 20)), by = Math.min(19, Math.floor(e.properties.y * 20));
        const x = bx / 20 + 0.025, y = by / 20 + 0.025;
        const key = JSON.stringify([e.game_id,surface,screen,device,bx,by]),
          v = heat.get(key) || { x, y, bx, by, surface, screen, device, count: 0, gameId: e.game_id };
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
  const measured = sessions.map((s) => s.activePlaySeconds).filter((n): n is number => n !== null && n !== undefined).sort((a,b) => a-b);
  const totalSeconds = measured.length ? measured.reduce((a,b) => a+b, 0) : null;
  const middle = Math.floor(measured.length / 2);
  const conversion = new Map<string, NonNullable<Analytics["launch"]>["conversion"][number]>();
  for (const s of sessions) {
    const names = groups.get(`${s.gameId}:${s.id}`)!.map(e => e.name);
    if (!names.includes("visit")) continue;
    const source = s.source || "Unknown", campaign = s.campaign || "Unspecified";
    const key = JSON.stringify([source, campaign]);
    const row = conversion.get(key) || { source, campaign, visits: 0, starts: 0, meaningful: 0, activeMeasured: 0 };
    const started = names.includes("round_start");
    row.visits++; if (started) row.starts++;
    if (started && (names.indexOf("round_complete", names.indexOf("round_start") + 1) >= 0 || (s.activePlaySeconds != null && s.activePlaySeconds >= 30))) row.meaningful++;
    if (started && s.activePlaySeconds != null) row.activeMeasured++;
    conversion.set(key, row);
  }
  const conversionRows = [...conversion.values()].sort((a,b) => b.visits - a.visits || a.source.localeCompare(b.source) || a.campaign.localeCompare(b.campaign));
  return {
    mostPlayedGames: summarizeMostPlayed(events,games,days,now),
    launch: { coverage: { sessions: sessions.length, visit: sessions.filter(s=>groups.get(`${s.gameId}:${s.id}`)!.some(e=>e.name === "visit")).length, loaded: sessions.filter(s=>groups.get(`${s.gameId}:${s.id}`)!.some(e=>e.name === "loaded")).length, roundStart: sessions.filter(s=>groups.get(`${s.gameId}:${s.id}`)!.some(e=>e.name === "round_start")).length, firstAction: sessions.filter(s=>groups.get(`${s.gameId}:${s.id}`)!.some(e=>e.name === "first_action")).length, roundComplete: sessions.filter(s=>s.completed).length, exit: sessions.filter(s=>groups.get(`${s.gameId}:${s.id}`)!.some(e=>e.name === "exit")).length }, visits: conversionRows.reduce((n,r)=>n+r.visits,0), exits: sessions.filter(s=>groups.get(`${s.gameId}:${s.id}`)!.some(e=>e.name === "exit")).length, conversion: conversionRows.slice(0,100), conversionTotal: conversionRows.length },
    windowEnd: new Date(now).toISOString(),
    loadedSessions: sessions.filter((s) => groups.get(`${s.gameId}:${s.id}`)!.some((e) => e.name === "loaded")).length,
    progressionSessions: sessions.filter((s) => groups.get(`${s.gameId}:${s.id}`)!.some((e) => e.name === "progression")).length,
    activePlay: { totalSeconds, averageSeconds: totalSeconds === null ? null : totalSeconds / measured.length, medianSeconds: measured.length ? (measured.length % 2 ? measured[middle] : (measured[middle-1] + measured[middle]) / 2) : null, measuredSessions: measured.length, eligibleSessions: sessions.filter((s) => groups.get(`${s.gameId}:${s.id}`)!.some((e) => e.name === "round_start")).length },
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
      "Round started",
      "First action",
      "Round completed",
    ].map((name, i) => ({ name, count: orderedFunnel[i] })),
    countries: countBy(sessions.map((s) => s.country)),
    sources: countBy(sessions.map((s) => s.source)),
    devices: countBy(sessions.map((s) => s.device)),
    dropoffs: countBy(
      sessions.filter((s) => !s.completed).map((s) => {
        const names = groups.get(`${s.gameId}:${s.id}`)!.map((event) => event.name);
        if (names.includes("visit") && !names.includes("round_start")) return "Viewed, no round start";
        if (names.includes("round_start") && !names.includes("first_action")) return "Started, no first action";
        return s.lastStep;
      }),
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
  return sqlAnalytics(workspace, gameId, days);
}
