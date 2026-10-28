import { controlledFixturePage } from "@/lib/controlled-fixture-page";

export function GET() {
  return new Response(controlledFixturePage, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}
