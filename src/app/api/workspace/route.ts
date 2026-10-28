import { requireIdentity, apiError } from "@/lib/auth";
import { snapshot } from "@/lib/workspace";
export async function GET(request: Request) {
  try {
    const user = await requireIdentity();
    const url = new URL(request.url);
    const days = Number(url.searchParams.get("days") || 14);
    return Response.json(
      await snapshot(
        user,
        url.searchParams.get("gameId") || undefined,
        [7, 14, 30].includes(days) ? days : 14,
      ),
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return apiError(e);
  }
}
