import { logout } from "@/lib/auth";
import { sameOrigin } from "@/lib/security";
export async function POST(request: Request) {
  if (!sameOrigin(request)) return new Response(null, { status: 403 });
  const { revoked } = await logout();
  return Response.json({ ok: true, revoked, ...(revoked ? {} : { warning: "Signed out locally; provider session revocation could not be confirmed." }) }, { headers: { "Cache-Control": "private, no-store" } });
}
