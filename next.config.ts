import type { NextConfig } from "next";
const config: NextConfig = {
  serverExternalPackages: ["@electric-sql/pglite", "pg"],
  poweredByHeader: false,
  devIndicators: false,
  headers() {
    return [{ source: "/api/:path*", headers: [{ key: "Cache-Control", value: "private, no-store" }] }];
  },
  experimental: {
    // Keep development usable on constrained disks without clearing existing caches.
    turbopackFileSystemCacheForDev: process.env.NEXT_DEV_DISK_CACHE !== "false",
  },
};
export default config;
