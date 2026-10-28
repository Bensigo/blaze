import { captureStatus, captureCors } from "@/lib/session-capture";
import { captureError, capturePreflight, boundedJson } from "../shared";
export const OPTIONS = capturePreflight;
export async function POST(request: Request) {
  const origin = request.headers.get("origin") || "";
  if (!origin) return new Response(null, { status: 403 });
  try {
    return Response.json(
      await captureStatus(await boundedJson(request), origin),
      { headers: captureCors(origin) },
    );
  } catch (e) {
    return captureError(e, origin);
  }
}
