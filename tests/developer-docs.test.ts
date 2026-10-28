import { describe, expect, it } from "vitest";
import { documentHeadings, integrationInstruction, readDeveloperDocs, developerGuideLink } from "../src/lib/developer-docs";
import { GET } from "../src/app/developers.md/route";

describe("canonical public developer documentation", () => {
  it("serves the exact canonical guides together for coding agents", async () => {
    const docs = await readDeveloperDocs();
    const response = await GET();
    const body = await response.text();
    expect(response.headers.get("Content-Type")).toContain("text/markdown");
    expect(docs).toHaveLength(3);
    for (const doc of docs) {
      expect(body).toContain(doc.markdown);
      expect(body).toContain(`https://blaze-bensigo.netlify.app${doc.source}`);
      expect(new Set(doc.headings.map(heading => heading.id)).size).toBe(doc.headings.length);
      expect(doc.markdown).not.toContain("web-game-marketing.vercel.app");
    }
    expect(integrationInstruction(docs[0].markdown)).toContain("PUBLIC_SDK_KEY");
  });
  it("does not put code-example headings in document navigation", () => {
    expect(documentHeadings("## Install\n```text\n## Not navigation\n```\n### Consent", "quickstart")).toEqual([
      { id: "quickstart-install", title: "Install", level: 2 },
      { id: "quickstart-consent", title: "Consent", level: 3 },
    ]);
    expect(() => integrationInstruction("No agent instruction")).toThrow();
  });
  it("routes canonical guide links to the human reading surface", () => {
    expect(developerGuideLink("./v1.md")).toBe("/developers#reference");
    expect(developerGuideLink("https://blaze-bensigo.netlify.app/docs/sdk/frame-v1.md")).toBe("/developers#frames");
    expect(developerGuideLink("https://example.com/other")).toBe("https://example.com/other");
  });
});
