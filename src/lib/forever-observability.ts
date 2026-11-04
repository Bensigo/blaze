import { z } from "zod";

// Private, content-free operator report from Forever. No game SDK credentials or
// visitor identities are exposed by this bridge. Unknown fields are stripped.
const count = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const label = z.string().max(100).regex(/^[a-zA-Z0-9_.:-]+$/);
const at = z.iso.datetime();
export const foreverReportSchema = z.object({
  schemaVersion: z.literal(1), generatedAt: at,
  release: z.string().regex(/^[a-f0-9]{40}$/).optional(),
  window: z.object({ days: z.literal(14), since: at, until: at }),
  summary: z.object({ sessions: count, gameViewSessions: count, playClickSessions: count, readySessions: count, startedSessions: count, actionSessions: count, noPlaySessions: count, errorSessions: count }),
  funnel: z.array(z.object({ stage: label, sessions: count })).max(10),
  games: z.array(z.object({ game: label, views: count, playClicks: count, ready: count, starts: count, actions: count.nullable(), actionCoverage: z.enum(["live", "finish_only", "unmeasured"]), completed: count, errorSessions: count })).max(100),
  errors: z.array(z.object({ code: label, game: label, browser: label, device: label, count, sessions: count, lastAt: at, source: z.enum(["browser", "server"]) })).max(100),
  delivery: z.object({ pending: count, dropped: count, writeFailures: count }),
  recent: z.array(z.object({ session: label, game: label, device: label, browser: label, at, stage: label, code: label.optional() })).max(100),
  limitations: z.array(z.string().max(1000)).max(20),
});
export type ForeverReport = z.infer<typeof foreverReportSchema>;
export type ForeverStatus = { status: "connected"; report: ForeverReport } | { status: "not_configured" | "unavailable"; reason: string };

function reportOrigin(env: NodeJS.ProcessEnv) {
  // Production never sends this private bearer to a user-selected host.
  if (env.NODE_ENV !== "production" && env.FOREVER_OBSERVABILITY_LOCAL_ORIGIN) {
    const u = new URL(env.FOREVER_OBSERVABILITY_LOCAL_ORIGIN);
    if (u.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(u.hostname) || u.username || u.password || u.pathname !== "/" || u.search || u.hash) throw Error("Invalid local diagnostics origin");
    return u.origin;
  }
  return "https://playforever.app";
}

export async function readForeverObservability(workspace: string, options: { env?: NodeJS.ProcessEnv; fetcher?: typeof fetch } = {}): Promise<ForeverStatus> {
  const env = options.env ?? process.env;
  const owner = env.FOREVER_OBSERVABILITY_WORKSPACE_ID;
  // Check ownership before making a request. A connection is deliberately bound
  // to one internal workspace, never all Blaze users or their game selection.
  if (!owner || workspace !== owner) return { status: "not_configured", reason: "Forever diagnostics is not connected to this workspace." };
  const token = env.FOREVER_OBSERVABILITY_TOKEN;
  if (!token || token.length < 32 || /\s/.test(token)) return { status: "not_configured", reason: "The private Forever diagnostics connection needs its server token." };
  try {
    const response = await (options.fetcher ?? fetch)(`${reportOrigin(env)}/api/internal/site-diagnostics`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      signal: AbortSignal.timeout(8000), redirect: "error", cache: "no-store",
    });
    if (!response.ok) return { status: "unavailable", reason: response.status === 401 || response.status === 403 ? "Forever rejected the diagnostics token. Check the private connection on both servers." : response.status === 404 || response.status === 503 ? "Forever diagnostics is not enabled on the running release." : "Forever could not produce its diagnostics report. Try again." };
    if (!response.body) throw Error("Missing report");
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = []; let size = 0;
    try {
      for (;;) {
        const part = await reader.read(); if (part.done) break;
        size += part.value.byteLength;
        if (size > 262144) { await reader.cancel(); throw Error("Report too large"); }
        chunks.push(part.value);
      }
    } finally { reader.releaseLock(); }
    const report = foreverReportSchema.parse(JSON.parse(Buffer.concat(chunks).toString("utf8")));
    if (Date.parse(report.window.since) > Date.parse(report.window.until) || Date.parse(report.generatedAt) < Date.now() - 15 * 60_000 || Date.parse(report.generatedAt) > Date.now() + 60_000) throw Error("Stale report");
    return { status: "connected", report };
  } catch { return { status: "unavailable", reason: "Forever diagnostics could not be read. Check that Forever is online and the current release supports the connection." }; }
}
