import { isIP } from "node:net";
import { getContext } from "@netlify/functions";

// Netlify supplies this request-scoped context to functions, including framework
// handlers. Unlike incoming headers, it is not supplied by the visitor.
export function visitorMetadata(request: Request): { ip: string; country: string } {
  if (process.env.VERCEL) {
    return {
      ip: (request.headers.get("x-forwarded-for") || "unknown").split(",")[0],
      country: (request.headers.get("x-vercel-ip-country") || "Unknown").slice(0, 3),
    };
  }
  // SITE_ID is a Netlify-reserved runtime variable. Local/mock contexts are
  // intentionally excluded; a real request-scoped context is still required.
  if (process.env.NODE_ENV !== "production" || !process.env.SITE_ID)
    return { ip: "unknown", country: "Unknown" };
  try {
    const context = getContext();
    const ip = typeof context.ip === "string" && isIP(context.ip) ? context.ip : "unknown";
    const code = context.geo?.country?.code;
    const country = typeof code === "string" && /^[A-Z]{2}$/.test(code) ? code : "Unknown";
    return { ip, country };
  } catch {
    return { ip: "unknown", country: "Unknown" };
  }
}
