import type { Metadata } from "next";
import type { ElementContent } from "hast";
import Markdown, { defaultUrlTransform, type Components } from "react-markdown";
import DeveloperGuide, { DocumentationCode } from "@/components/developer-guide";
import { developerGuideLink, developerOrigin, integrationInstruction, readDeveloperDocs, sectionSlug } from "@/lib/developer-docs";
import "./developers.css";

export const dynamic = "force-static";
export const metadata: Metadata = {
  title: "Blaze SDK — Developer guide",
  description: "Integrate the Blaze browser SDK: installation, consent, gameplay events, heatmaps, identity and the Frame v1 bridge.",
  alternates: { canonical: `${developerOrigin}/developers` },
};

function textOf(node: ElementContent): string {
  if (node.type === "text") return node.value;
  return node.type === "element" ? node.children.map(textOf).join("") : "";
}

export default async function DevelopersPage() {
  const documents = await readDeveloperDocs();
  const guides = documents.map(doc => {
    const components: Components = {
      h1: ({ children, node }) => <h2 id={`${doc.id}-${sectionSlug(node?.children.map(textOf).join("") || "")}`}>{children}</h2>,
      h2: ({ children, node }) => <h3 id={`${doc.id}-${sectionSlug(node?.children.map(textOf).join("") || "")}`}>{children}</h3>,
      h3: ({ children, node }) => <h4 id={`${doc.id}-${sectionSlug(node?.children.map(textOf).join("") || "")}`}>{children}</h4>,
      pre: ({ children, node }) => {
        const code = node?.children.find(child => child.type === "element" && child.tagName === "code");
        const classes = code?.type === "element" && Array.isArray(code.properties.className) ? code.properties.className.join(" ") : "";
        const language = classes.match(/language-([a-z]+)/)?.[1] || "code";
        const text = node?.children.map(textOf).join("") || "";
        const block = <DocumentationCode text={text} language={language} >{children}</DocumentationCode>;
        return language === "text" && doc.id === "quickstart" ? <details className="dev-agent-brief"><summary>Read the agent instruction</summary>{block}</details> : block;
      },
    };
    return { id: doc.id, title: doc.title, detail: doc.detail, source: doc.source, headings: doc.headings, content: <Markdown components={components} skipHtml urlTransform={value => defaultUrlTransform(developerGuideLink(value))}>{doc.markdown}</Markdown> };
  });
  return <DeveloperGuide guides={guides} instruction={integrationInstruction(documents[0].markdown)}/>;
}
