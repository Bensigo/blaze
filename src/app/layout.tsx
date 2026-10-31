import type { Metadata } from "next";
import "./globals.css";
import "../components/account-settings.css";
import "../components/action-board.css";
import "../components/actions-page.css";
import "../components/content-studio.css";
import "../components/media-workspace.css";
import "../components/discovery-review.css";
import "../components/game-connections.css";
import "../components/launch-links.css";


export const metadata: Metadata = {
  title: "Blaze — see where players stop",
  description: "Player analytics, consented capture, and a content workflow for web games.",
};
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
