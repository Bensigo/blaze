import fixture from "@/lib/controlled-fixture-manifest.json";

// Public, explicitly controlled acceptance fixture; it creates no records or events.
export function GET() {
  return Response.json(fixture);
}
