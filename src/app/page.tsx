import type { Metadata } from "next";
import Landing from "@/components/landing";

const title = "Blaze — Analytics for browser games";
const description = "See which links bring in players, where they stop, and how often they return. Track your web game with the open source Blaze SDK.";

export const metadata: Metadata = {
  title,
  description,
  openGraph: { title, description, type: "website", siteName: "Blaze" },
};

export default function Home() {
  return <Landing />;
}
