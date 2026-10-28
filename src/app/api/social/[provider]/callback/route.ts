import { requireIdentity } from "@/lib/auth";
import { finishSocialAuthorization } from "@/lib/social-oauth";
import { isSocialProvider } from "@/lib/social-provider";
import { appOrigin } from "@/lib/app-origin";
export async function GET(request: Request, context: { params: Promise<{ provider: string }> }) {
  const origin = appOrigin(request);
  if (!origin) return new Response("Application URL is not configured.", { status: 503 });
  const provider = (await context.params).provider;
  let status = "failed";
  try {
    if (isSocialProvider(provider)) status = await finishSocialAuthorization(await requireIdentity(), provider, request);
  } catch { /* Callback errors never echo authorization codes, state or provider responses. */ }
  const target = new URL("/app", origin);
  target.searchParams.set("social", status);
  if (isSocialProvider(provider)) target.searchParams.set("provider", provider);
  return Response.redirect(target, 303);
}
