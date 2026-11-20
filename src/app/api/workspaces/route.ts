import { z } from "zod";
import { requireIdentity, apiError, HttpError } from "@/lib/auth";
import { rateLimit } from "@/lib/db";
import { sameOrigin } from "@/lib/security";
import { createWorkspace, listWorkspaces, renameWorkspace, requireOwnWorkspace, setActiveWorkspace } from "@/lib/workspaces";

const noStore = { "Cache-Control": "private, no-store" };

/** The workspaces this account can open, and which one is active in this browser. */
export async function GET() {
  try {
    const user = await requireIdentity();
    return Response.json({ workspaces: await listWorkspaces(user) }, { headers: noStore });
  } catch (e) {
    return apiError(e);
  }
}

const body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create"), name: z.string().max(200) }),
  z.object({ action: z.literal("switch"), id: z.string().max(100) }),
  z.object({ action: z.literal("rename"), id: z.string().max(100), name: z.string().max(200) }),
]);

/** create (and switch to it), switch, or rename a workspace. */
export async function POST(request: Request) {
  try {
    if (!sameOrigin(request)) throw new HttpError(403, "Use this workspace to make changes.");
    const user = await requireIdentity();
    if (Number(request.headers.get("content-length") || 0) > 4000) throw new HttpError(413, "Request too large.");
    let parsed: z.infer<typeof body>;
    try {
      parsed = body.parse(JSON.parse(await request.text()));
    } catch {
      throw new HttpError(400, "That request isn't one this page sends.");
    }
    if (!(await rateLimit(`workspaces:${user.id}`, 30))) throw new HttpError(429, "Too many requests. Try again shortly.");
    if (parsed.action === "create") {
      const workspace = await createWorkspace(user, parsed.name);
      await setActiveWorkspace(user, workspace);
      return Response.json({ id: workspace }, { headers: noStore });
    }
    const workspace = await requireOwnWorkspace(user, parsed.id);
    if (parsed.action === "switch") await setActiveWorkspace(user, workspace);
    else await renameWorkspace(user, workspace, parsed.name);
    return Response.json({ id: workspace }, { headers: noStore });
  } catch (e) {
    return apiError(e);
  }
}
