import { createSession } from "@/lib/auth";
import { sameOrigin } from "@/lib/security";
export async function POST(request: Request) {
  if (process.env.NODE_ENV === "production" || process.env.VERCEL)
    return new Response(null, { status: 404 });
  if (!sameOrigin(request)) return new Response(null, { status: 403 });
  await createSession({
    id: "local-developer",
    email: "developer@localhost",
    name: "Local workspace",
  });
  return Response.json({ ok: true });
}
