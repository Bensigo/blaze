import { query } from "@/lib/db";
export async function GET() {
  const candidate = process.env.NEXT_PUBLIC_BLAZE_RELEASE_SHA || "";
  const release = /^[a-f0-9]{40}$/.test(candidate) ? candidate : null;
  // Non-secret runtime readback for release verification; never expose env values.
  const automation = {
    cloudProduction: process.env.BLAZE_CLOUD_PRODUCTION_ENABLED === "true",
    cloudPilot: process.env.BLAZE_CLOUD_PILOT_ENABLED === "true",
    jevScriptReview: process.env.BLAZE_JEV_SCRIPT_REVIEW_ENABLED === "true",
    dailyIdeas: process.env.BLAZE_DAILY_IDEAS_ENABLED === "true",
    legacyDaily: process.env.BLAZE_LEGACY_DAILY_ENABLED === "true",
    cloudWatchdog: process.env.BLAZE_CLOUD_WATCHDOG_ENABLED === "true",
    watchdogSchedule: process.env.BLAZE_CLOUD_WATCHDOG_SCHEDULE_ENABLED === "true",
  };
  try {
    await query("SELECT 1");
    return Response.json(
      { status: "ok", database: true, release, automation },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return Response.json(
      { status: "setup_required", database: false, release, automation },
      { status: 503 },
    );
  }
}
