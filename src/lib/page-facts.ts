import { load } from "cheerio";
export type PageFacts = {
  url: string;
  title: string;
  description: string;
  words: number;
  robots: string;
  xRobots: string;
  content: string;
  canonical: string;
  heading: string;
  lang: string;
  viewport: string;
  ogTitle: string;
  ogDescription: string;
  ogImage: string;
  jsonLdCount: number;
  jsonLdInvalid: number;
  gameSchema: boolean;
};
export const cleanUrl = (input: string) => {
  const u = new URL(input);
  u.search = "";
  u.hash = "";
  return u.href;
};
export function extractPage(url: string, body: string, xRobots: string): PageFacts {
  const $ = load(body);
  const meta = (name: string) =>
    $("meta")
      .toArray()
      .filter((e) => ($(e).attr("name") || "").toLowerCase() === name)
      .map((e) => ($(e).attr("content") || "").trim())
      .filter(Boolean)
      .join("; ")
      .slice(0, 300);
  const title = $("title").first().text().trim().slice(0, 200),
    description = meta("description"),
    robots = [meta("robots"), meta("googlebot")].filter(Boolean).join("; ");
  const canonical = $('link[rel~="canonical" i]').first().attr("href")?.trim() || "";
  const heading = $("h1").first().text().trim();
  const lang = ($("html").first().attr("lang") || "").trim().slice(0,100);
  const viewport = meta("viewport");
  const og = (name: string) => $("meta").toArray().filter(e => ($(e).attr("property") || "").toLowerCase() === name).map(e => ($(e).attr("content") || "").trim()).find(Boolean) || "";
  const ogTitle = og("og:title"), ogDescription = og("og:description"), ogImage = og("og:image");
  const scripts = $("script").toArray().filter(e => ($(e).attr("type") || "").trim().toLowerCase().split(";")[0] === "application/ld+json");
  let jsonLdInvalid = 0, gameSchema = false;
  for (const el of scripts) {
    try {
      const data: unknown = JSON.parse($(el).text());
      // Limit traversal to objects and arrays; do not evaluate or fetch contexts.
      const queue: unknown[] = [data]; let visited = 0;
      while (queue.length && visited++ < 10000) {
        const value = queue.pop();
        if (!value || typeof value !== "object") continue;
        if (Array.isArray(value)) { queue.push(...value.slice(0,10000)); continue; }
        const obj = value as Record<string, unknown>;
        const types = Array.isArray(obj["@type"]) ? obj["@type"] : [obj["@type"]];
        if (types.some(t => typeof t === "string" && /^(?:(?:https?:)?\/\/schema\.org\/)?(?:VideoGame|SoftwareApplication)$/i.test(t))) gameSchema = true;
        queue.push(...Object.values(obj).slice(0,10000));
      }
    } catch { jsonLdInvalid++; }
  }
  $("script,style,noscript,template").remove();
  const content = $("body").text().replace(/\s+/g, " ").trim();
  return {
    url: cleanUrl(url),
    title,
    description,
    robots,
    xRobots: xRobots.slice(0, 300),
    words: content ? content.split(/\s+/).length : 0,
    content: content.slice(0, 100_000),
    canonical,
    heading, lang, viewport, ogTitle, ogDescription, ogImage, jsonLdCount: scripts.length, jsonLdInvalid, gameSchema,
  };
}
