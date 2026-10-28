import type { Metadata } from "next";
import "./globals.css";

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
