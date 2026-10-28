import type { ProviderSecret } from "../types";
import { token } from "./common";
export async function braveSearch(
  query: string,
  secret: ProviderSecret,
): Promise<{ results: { title: string; url: string; description: string }[] }> {
  const params = new URLSearchParams({
    q: query.slice(0, 300),
    count: "10",
    result_filter: "web",
    text_decorations: "false",
  });
  const response = await fetch(
    `https://api.search.brave.com/res/v1/web/search?${params}`,
    {
      headers: {
        Accept: "application/json",
        "X-Subscription-Token": token(secret),
      },
      redirect: "error",
      signal: AbortSignal.timeout(15000),
    },
  );
  if (!response.ok)
    throw new Error(`Brave Search failed (HTTP ${response.status})`);
  const data = await response.json();
  if (!data || typeof data !== "object" || data.type !== "search")
    throw new Error("Invalid Brave Search response");
  const results = Array.isArray(data.web?.results) ? data.web.results : [];
  return {
    results: results
      .slice(0, 10)
      .flatMap(
        (r: { title?: unknown; url?: unknown; description?: unknown }) => {
          try {
            if (typeof r.url !== "string") return [];
            const u = new URL(r.url);
            if (
              !["https:", "http:"].includes(u.protocol) ||
              u.username ||
              u.password
            )
              return [];
            u.search = "";
            u.hash = "";
            return [
              {
                title: String(r.title || "").slice(0, 180),
                url: u.href,
                description: String(r.description || "").slice(0, 300),
              },
            ];
          } catch {
            return [];
          }
        },
      ),
  };
}
