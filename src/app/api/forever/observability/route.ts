import { requireIdentity, apiError } from "@/lib/auth";
import { readForeverObservability } from "@/lib/forever-observability";

export async function GET() {
  try {
    const user = await requireIdentity();
    return Response.json(await readForeverObservability(user.workspace_id), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return apiError(error); }
}
