// Retired endpoint: content production is no longer available.
export default async function () {
  return new Response(null, { status: 410 });
}
