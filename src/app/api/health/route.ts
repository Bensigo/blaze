import { query } from "@/lib/db";
export async function GET() {
  try {
    await query("SELECT 1");
    return Response.json(
      { status: "ok", database: true },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return Response.json(
      { status: "setup_required", database: false },
      { status: 503 },
    );
  }
}
