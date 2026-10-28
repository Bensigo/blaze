import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Web Game Studio",
  description: "A workspace for web game growth.",
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
