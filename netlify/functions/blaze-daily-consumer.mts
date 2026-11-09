// Retired endpoint: scheduled research and publishing are no longer available.
export default async function () {
  return new Response(null, { status: 410 });
}
