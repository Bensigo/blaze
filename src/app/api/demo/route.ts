import { buildDemo } from "@/lib/demo";
export async function GET(request: Request) {
  const url = new URL(request.url);
  return Response.json(
    buildDemo(
      url.searchParams.get("gameId") || undefined,
      Number(url.searchParams.get("days") || 30),
    ),
    { headers: { "Cache-Control": "no-store" } },
  );
}
