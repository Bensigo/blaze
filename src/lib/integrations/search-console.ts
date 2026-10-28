import type { ProviderSecret } from "../types";
import { api, jsonHeaders } from "./common";
export type SearchPeriod = {
  startDate: string;
  endDate: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
};
export type SearchComparison = {
  property: string;
  page: string;
  recent: SearchPeriod | null;
  prior: SearchPeriod | null;
  failures: ("recent" | "prior")[];
};
export const searchConsoleReportUrl = (property: string) =>
  `https://search.google.com/search-console/performance/search-analytics?resource_id=${encodeURIComponent(property)}`;
export async function verifySearchConsole(
  secret: ProviderSecret,
): Promise<{ connected: boolean; accountId?: string; details: string }> {
  if (!secret.accountId)
    return {
      connected: false,
      details: "Choose a Search Console property URL or sc-domain: property.",
    };
  try {
    const data = await api(
      "https://www.googleapis.com/webmasters/v3/sites",
      secret,
    );
    const match =
      Array.isArray(data.siteEntry) &&
      data.siteEntry.find(
        (entry: { siteUrl?: unknown; permissionLevel?: unknown }) =>
          entry.siteUrl === secret.accountId &&
          ["siteOwner", "siteFullUser", "siteRestrictedUser"].includes(
            String(entry.permissionLevel),
          ),
      );
    if (!match)
      return {
        connected: false,
        details:
          "The selected property was not found among accessible Search Console sites.",
      };
    return {
      connected: true,
      accountId: secret.accountId,
      details:
        "Search Console property access verified; reporting may be delayed or empty.",
    };
  } catch {
    return {
      connected: false,
      details:
        "Search Console verification failed. Check the token, readonly scope and property access.",
    };
  }
}
function covers(property: string, page: string): boolean {
  try {
    const target = new URL(page);
    if (
      !["https:", "http:"].includes(target.protocol) ||
      target.username ||
      target.password
    )
      return false;
    if (property.startsWith("sc-domain:")) {
      const host = property.slice(10).toLowerCase();
      return (
        /^[a-z0-9.-]+$/.test(host) &&
        (target.hostname.toLowerCase() === host ||
          target.hostname.toLowerCase().endsWith(`.${host}`))
      );
    }
    const prop = new URL(property);
    return (
      !prop.username &&
      !prop.password &&
      prop.origin === target.origin &&
      target.pathname.startsWith(prop.pathname)
    );
  } catch {
    return false;
  }
}
function isoDays(when: Date, offset: number) {
  return new Date(
    Date.UTC(
      when.getUTCFullYear(),
      when.getUTCMonth(),
      when.getUTCDate() + offset,
    ),
  )
    .toISOString()
    .slice(0, 10);
}
export function searchConsoleWindows(now = new Date()) {
  const date = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const part = (key: string) => date.find((x) => x.type === key)?.value || "";
  const day = new Date(
    `${part("year")}-${part("month")}-${part("day")}T00:00:00Z`,
  );
  return {
    recent: { startDate: isoDays(day, -30), endDate: isoDays(day, -3) },
    prior: { startDate: isoDays(day, -58), endDate: isoDays(day, -31) },
  };
}
export async function searchConsoleComparison(
  secret: ProviderSecret,
  gameUrl: string,
  now = new Date(),
): Promise<SearchComparison> {
  const property = secret.accountId;
  if (!property) throw new Error("Search Console property is missing");
  const page = new URL(gameUrl);
  page.search = "";
  page.hash = "";
  const pageUrl = page.href;
  if (!covers(property, pageUrl))
    throw new Error(
      "The selected Search Console property does not cover this game URL",
    );
  const windows = searchConsoleWindows(now);
  const endpoint = `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(property)}/searchAnalytics/query`;
  async function getPeriod(range: {
    startDate: string;
    endDate: string;
  }): Promise<SearchPeriod | null> {
    const data = await api(endpoint, secret, {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({
        ...range,
        type: "web",
        dataState: "final",
        rowLimit: 1,
        dimensionFilterGroups: [
          {
            groupType: "and",
            filters: [
              { dimension: "page", operator: "equals", expression: pageUrl },
            ],
          },
        ],
      }),
    });
    if (
      data.rows === undefined ||
      (Array.isArray(data.rows) && !data.rows.length)
    )
      return null;
    if (!Array.isArray(data.rows) || data.rows.length !== 1)
      throw new Error("Invalid Search Console response");
    const row = data.rows[0];
    if (
      !["clicks", "impressions", "ctr", "position"].every(
        (k) =>
          typeof row[k] === "number" && Number.isFinite(row[k]) && row[k] >= 0,
      ) ||
      row.ctr > 1
    )
      throw new Error("Invalid Search Console metrics");
    return {
      ...range,
      clicks: row.clicks,
      impressions: row.impressions,
      ctr: row.ctr,
      position: row.position,
    };
  }
  const all = await Promise.allSettled([
    getPeriod(windows.recent),
    getPeriod(windows.prior),
  ]);
  return {
    property,
    page: pageUrl,
    recent: all[0].status === "fulfilled" ? all[0].value : null,
    prior: all[1].status === "fulfilled" ? all[1].value : null,
    failures: all.flatMap((v, i) =>
      v.status === "rejected"
        ? [i === 0 ? ("recent" as const) : ("prior" as const)]
        : [],
    ),
  };
}

export type SearchQueryObservation = SearchPeriod & { query: string };
/** Finalized, exact-page query rows. These are observed search results, not search volume or causal ranking evidence. */
export async function searchConsoleQueries(secret: ProviderSecret, gameUrl: string, now = new Date()): Promise<{ property: string; page: string; rows: SearchQueryObservation[]; droppedRows: number; startDate: string; endDate: string }> {
  const property = secret.accountId;
  if (!property) throw new Error("Search Console property is missing");
  const page = new URL(gameUrl);
  page.search = ""; page.hash = "";
  if (!covers(property, page.href)) throw new Error("The selected Search Console property does not cover this game URL");
  const range = searchConsoleWindows(now).recent;
  const endpoint = `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(property)}/searchAnalytics/query`;
  const data = await api(endpoint, secret, {
    method: "POST", headers: jsonHeaders,
    body: JSON.stringify({ ...range, type: "web", dataState: "final", dimensions: ["query"], rowLimit: 25,
      dimensionFilterGroups: [{ groupType: "and", filters: [{ dimension: "page", operator: "equals", expression: page.href }] }] }),
  });
  if (data.rows !== undefined && !Array.isArray(data.rows)) throw new Error("Invalid Search Console response");
  const rows: SearchQueryObservation[] = [];
  for (const row of (data.rows || []).slice(0, 25)) {
    const q = row?.keys?.[0];
    if (!Array.isArray(row?.keys) || row.keys.length !== 1 || typeof q !== "string" || q.length < 1 || q.length > 100 || /[@<>\r\n]|https?:\/\/|www\.|\d{5}/i.test(q)) continue;
    if (!["clicks", "impressions", "ctr", "position"].every(k => typeof row[k] === "number" && Number.isFinite(row[k]) && row[k] >= 0) || row.ctr > 1 || row.impressions < 10) continue;
    rows.push({ query: q, ...range, clicks: row.clicks, impressions: row.impressions, ctr: row.ctr, position: row.position });
  }
  return { property, page: page.href, ...range, rows, droppedRows: (data.rows || []).length - rows.length };
}
