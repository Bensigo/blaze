import { query } from "@/lib/db";
export async function GET() {
  const candidate = process.env.NEXT_PUBLIC_BLAZE_RELEASE_SHA || "";
  const release = /^[a-f0-9]{40}$/.test(candidate) ? candidate : null;
  try {
    await query("SELECT 1");
    return Response.json(
      { status: "ok", database: true, release },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return Response.json(
      { status: "setup_required", database: false, release },
      { status: 503 },
    );
  }
}
