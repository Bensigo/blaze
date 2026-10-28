import { ingest } from "@/lib/telemetry";
import { query } from "@/lib/db";
import type { Game } from "@/lib/types";
export async function POST(request: Request) {
  return ingest(request);
}
export async function OPTIONS(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return new Response(null, { status: 403 });
  const games = await query<{ body: Game }>(
    `SELECT body FROM records WHERE kind='game' AND body->'origins' ? $1`,
    [origin],
  );
  if (!games.length) return new Response(null, { status: 403 });
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "600",
      Vary: "Origin",
    },
  });
}
