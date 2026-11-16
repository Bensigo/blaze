import { buildDemo, demoSessionEvents } from "@/lib/demo";
export async function GET(request: Request) {
  const url = new URL(request.url);
  const sessionId = url.searchParams.get("sessionId");
  if (sessionId) {
    const events = demoSessionEvents(sessionId, url.searchParams.get("gameId") || undefined, Number(url.searchParams.get("days") || 30));
    return Response.json({ events, captures: [] }, { status: events.length ? 200 : 404, headers: { "Cache-Control": "no-store" } });
  }
  return Response.json(
    buildDemo(
      url.searchParams.get("gameId") || undefined,
      Number(url.searchParams.get("days") || 30),
    ),
    { headers: { "Cache-Control": "no-store" } },
  );
}
