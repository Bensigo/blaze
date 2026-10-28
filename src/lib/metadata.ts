import { load } from "cheerio";
import { fetchPublic } from "./integrations/safe-fetch";
import { HttpError } from "./http-error";
export function imageUrl(value: string, base: string) {
  if (!value) return "";
  try {
    const u = new URL(value, base);
    if (u.username || u.password || !["https:", "http:"].includes(u.protocol))
      return "";
    return u.href.slice(0, 2000);
  } catch {
    return "";
  }
}
export async function gameMetadata(input: string, appOrigin: string) {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new HttpError(400, "Enter the full game URL.");
  }
  if (
    url.username ||
    url.password ||
    !["http:", "https:"].includes(url.protocol)
  )
    throw new HttpError(400, "Use a public HTTP or HTTPS game URL.");
  url.hash = "";
  url.search = "";
  if (url.origin === appOrigin && url.pathname === "/fixture/index.html")
    return {
      url: url.href,
      title: "Star Catch",
      description:
        "Move across the night sky and catch three falling stars. A controlled web-game fixture for testing recordings and telemetry.",
      image: `${appOrigin}/fixture/cover.svg`,
      metadataStatus: "Controlled fixture",
    };
  try {
    const result = await fetchPublic(url.href);
    if (result.status < 200 || result.status >= 400) throw new Error();
    const $ = load(result.body);
    return {
      url: result.url,
      title: (
        $('meta[property="og:title"]').attr("content") ||
        $("title").first().text() ||
        url.hostname
      )
        .trim()
        .slice(0, 120),
      description: (
        $('meta[property="og:description"]').attr("content") ||
        $('meta[name="description"]').attr("content") ||
        ""
      )
        .trim()
        .slice(0, 500),
      image: imageUrl(
        $('meta[property="og:image"]').attr("content") ||
          $('meta[name="twitter:image"]').attr("content") ||
          "",
        result.url,
      ),
      metadataStatus: "Metadata retrieved",
    };
  } catch {
    throw new HttpError(
      400,
      "The game page could not be retrieved safely. Check that the URL is public and accessible.",
    );
  }
}
