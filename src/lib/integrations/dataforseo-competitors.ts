import type { CompetitorTarget, CompetitorMarket, CompetitorEvidence, EvidenceStatus } from "../competitor-types";

const locations: Record<string, number> = { US: 2840, GB: 2826, NG: 2566, AE: 2784, CA: 2124, AU: 2036, IN: 2356 };
const MAX_BYTES = 2_000_000;

function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function number(value: unknown): value is number { return typeof value === "number" && Number.isFinite(value) && value >= 0; }

function exactUrl(value: string): string | null {
  try {
    const u = new URL(value);
    if (!["http:", "https:"].includes(u.protocol) || u.username || u.password) return null;
    u.hash = "";
    // Tracking query parameters are not generally safe to discard: pages may be distinguished by query.
    return u.href;
  } catch { return null; }
}

async function call(path: string, input: object, credentials: { login: string; password: string }, fetcher: typeof fetch): Promise<unknown[]> {
  const response = await fetcher(`https://api.dataforseo.com/v3/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Basic ${Buffer.from(`${credentials.login}:${credentials.password}`).toString("base64")}` },
    body: JSON.stringify([input]), redirect: "error", signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) throw new Error("Provider request failed");
  const length = Number(response.headers.get("content-length"));
  if (Number.isFinite(length) && length > MAX_BYTES) throw new Error("Provider response too large");
  if (!response.body) throw new Error("Provider response unavailable");
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) { const {done, value} = await reader.read(); if (done) break; size += value.byteLength; if (size > MAX_BYTES) { await reader.cancel(); throw new Error("Provider response too large"); } chunks.push(value); }
  } finally { reader.releaseLock(); }
  const json: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if (!isRecord(json)) throw new Error("Invalid provider response");
  if (json.status_code !== 20000 || !Array.isArray(json.tasks) || json.tasks.length !== 1 || !isRecord(json.tasks[0]) || json.tasks[0].status_code !== 20000 || !Array.isArray(json.tasks[0].result)) throw new Error("Provider task failed");
  const result = json.tasks[0].result;
  if (!result.length) return [];
  if (!isRecord(result[0]) || !Array.isArray(result[0].items)) throw new Error("Invalid provider response");
  return result[0].items;
}

export async function collectCompetitorEvidence(targets: CompetitorTarget[], market: CompetitorMarket, credentials: {login:string;password:string}, fetcher: typeof fetch = fetch): Promise<CompetitorEvidence> {
  const web = targets.filter(t => t.platform === "web").slice(0, 20);
  const ios = targets.filter(t => t.platform === "ios" && t.appId).slice(0, 20);
  const android = targets.filter(t => t.platform === "android" && t.appId).slice(0, 20);
  const evidence: CompetitorEvidence = { web: {}, stores: {}, sources: { search: "skipped", traffic: "skipped", ios: "skipped", android: "skipped" } };
  for (const target of web) evidence.web[target.id] = {rank:null, estimatedVisits:null};
  const country = locations[market.country];
  if (!country) { for (const key of ["search", "traffic", "ios", "android"] as const) evidence.sources[key] = "unavailable"; return evidence; }
  const base = {location_code:country, language_code:"en"};
  const run = async (key: "search"|"traffic"|"ios"|"android", work: () => Promise<void>) => {
    try { await work(); evidence.sources[key] = "ok" as EvidenceStatus; } catch {
      evidence.sources[key] = "unavailable" as EvidenceStatus;
      if (key === "search" || key === "traffic") for (const t of web) { if (key === "search") evidence.web[t.id].rank = null; else evidence.web[t.id].estimatedVisits = null; }
      else for (const t of (key === "ios" ? ios : android)) delete evidence.stores[t.id];
    }
  };
  const jobs: Promise<void>[] = [];
  if (web.length && market.keyword.trim()) jobs.push(run("search", async () => {
    const items = await call("serp/google/organic/live/advanced", {...base, keyword:market.keyword.trim(), device:market.device, depth:10}, credentials, fetcher);
    for (const t of web) {
      const url = exactUrl(t.url);
      const match = items.find((item) => isRecord(item) && item.type === "organic" && typeof item.url === "string" && url !== null && exactUrl(item.url) === url);
      if (match !== undefined && (!isRecord(match) || !number(match.rank_group) || !Number.isInteger(match.rank_group) || match.rank_group < 1)) throw new Error("Invalid search rank");
      if (isRecord(match) && number(match.rank_group) && match.rank_group <= 10) evidence.web[t.id].rank = match.rank_group;
    }
  }));
  if (web.length) jobs.push(run("traffic", async () => {
    const items = await call("dataforseo_labs/google/bulk_traffic_estimation/live", {...base, targets:web.map(t => t.url)}, credentials, fetcher);
    for (const t of web) {
      const url = exactUrl(t.url);
      const match = items.find((item) => isRecord(item) && typeof item.target === "string" && url !== null && exactUrl(item.target) === url);
      const metrics = isRecord(match) && isRecord(match.metrics) ? match.metrics : null;
      const organic = metrics && isRecord(metrics.organic) ? metrics.organic : null;
      const etv = organic?.etv;
      if (match !== undefined && !number(etv)) throw new Error("Invalid traffic estimate");
      if (typeof etv === "number" && Number.isFinite(etv) && etv >= 0) evidence.web[t.id].estimatedVisits = etv;
    }
  }));
  for (const [key, list, engine, field] of [["ios", ios, "apple", "app_store_search_organic"], ["android", android, "google", "google_play_search_organic"]] as const) {
    if (!list.length) continue;
    jobs.push(run(key, async () => {
      const items = await call(`dataforseo_labs/${engine}/bulk_app_metrics/live`, {...base, app_ids:list.map(t => t.appId)}, credentials, fetcher);
      for (const target of list) {
        const item = items.find((item) => isRecord(item) && item.app_id === target.appId);
        const metrics = isRecord(item) && isRecord(item.metrics) ? item.metrics : null;
        const m = metrics && isRecord(metrics[field]) ? metrics[field] : null;
        if (item === undefined) continue;
        if (!m || !number(m.count) || !number(m.pos_1) || !number(m.pos_2_3) || !number(m.pos_4_10) || ![m.count,m.pos_1,m.pos_2_3,m.pos_4_10].every(Number.isInteger) || m.pos_1 + m.pos_2_3 + m.pos_4_10 > m.count) throw new Error("Invalid store metrics");
        evidence.stores[target.id] = {rankedKeywords:m.count, topTenKeywords:m.pos_1+m.pos_2_3+m.pos_4_10, estimatedSearchVolume:typeof m.search_volume === "number" && Number.isFinite(m.search_volume) && m.search_volume >= 0 ? m.search_volume : null};
      }
    }));
  }
  await Promise.all(jobs);
  return evidence;
}
