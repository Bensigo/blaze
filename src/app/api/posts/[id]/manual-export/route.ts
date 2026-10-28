import { apiError, HttpError, requireIdentity } from "@/lib/auth";
import { prepareManualExport } from "@/lib/manual-export";
import { sameOrigin } from "@/lib/security";
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    if (!sameOrigin(request)) throw new HttpError(403, "Use this workspace to make changes.");
    const user = await requireIdentity(), { id } = await params;
    return Response.json(await prepareManualExport(user.workspace_id, id), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return apiError(error); }
}
