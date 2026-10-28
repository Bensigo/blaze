import { readFile } from "node:fs/promises";
import path from "node:path";

export const developerOrigin = "https://blaze-bensigo.netlify.app";
export const sdkGuides = [
  { id: "quickstart", title: "Quickstart", file: "quickstart.md", detail: "Install, consent and verify your first session." },
  { id: "reference", title: "SDK v1 reference", file: "v1.md", detail: "Events, identity, delivery and measurement." },
  { id: "frames", title: "Iframe & capture", file: "frame-v1.md", detail: "The reviewed Frame v1 bridge and its boundaries." },
] as const;

export function sectionSlug(value: string) {
  return value.replace(/[`*_]/g, "").normalize("NFKD").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export function documentHeadings(markdown: string, prefix: string) {
  let fenced = false;
  return markdown.split("\n").flatMap(line => {
    if (line.startsWith("```")) { fenced = !fenced; return []; }
    const match = !fenced && line.match(/^(#{2,3}) (.+)$/);
    return match ? [{ id: `${prefix}-${sectionSlug(match[2])}`, title: match[2].replace(/[`*_]/g, ""), level: match[1].length }] : [];
  });
}

export async function readDeveloperDocs() {
  return Promise.all(sdkGuides.map(async guide => {
    const markdown = await readFile(path.join(process.cwd(), "public", "docs", "sdk", guide.file), "utf8");
    return { ...guide, markdown, source: `/docs/sdk/${guide.file}`, headings: documentHeadings(markdown, guide.id) };
  }));
}

export function integrationInstruction(quickstart: string) {
  const instruction = quickstart.match(/```text\r?\n([\s\S]*?)\r?\n```/)?.[1];
  if (!instruction?.trim()) throw new Error("The canonical quickstart must contain the agent instruction.");
  return instruction.trim();
}

export function developerGuideLink(value: string) {
  const target = sdkGuides.find(guide => value === `./${guide.file}` || value === `${developerOrigin}/docs/sdk/${guide.file}` || value === `/docs/sdk/${guide.file}`);
  return target ? `/developers#${target.id}` : value;
}
