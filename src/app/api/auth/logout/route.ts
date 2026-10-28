import { logout } from "@/lib/auth";
import { sameOrigin } from "@/lib/security";
export async function POST(request: Request) {
  if (!sameOrigin(request)) return new Response(null, { status: 403 });
  await logout();
  return Response.json({ ok: true });
}
