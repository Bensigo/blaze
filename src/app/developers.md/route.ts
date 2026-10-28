import { developerOrigin, readDeveloperDocs } from "@/lib/developer-docs";

export const dynamic = "force-static";
export async function GET() {
  const docs = await readDeveloperDocs();
  const text = `# Blaze developer documentation\n\nHuman guide: ${developerOrigin}/developers\n\nThese sections are generated from the canonical SDK Markdown sources. Use the registered game's public SDK key. Never embed private or server credentials.\n\n${docs.map(doc => `Source: ${developerOrigin}${doc.source}\n\n${doc.markdown}`).join("\n\n---\n\n")}`;
  return new Response(text, { headers: { "Content-Type": "text/markdown; charset=utf-8" } });
}
