import { appOrigin } from "@/lib/app-origin";
import { googleAvailable } from "@/lib/neon-auth";
export async function GET(request: Request) {
  return Response.json({ googleConfigured: Boolean(appOrigin(request)) && googleAvailable() }, { headers: { "Cache-Control": "no-store" } });
}
