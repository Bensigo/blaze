import { defineConfig } from "vitest/config";
import { resolve } from "node:path";
export default defineConfig({
  resolve: { alias: { "@": resolve("src") } },
  test: {
    server: { deps: { inline: ["@neondatabase/auth"] } },
    include: ["tests/**/*.test.ts"],
    exclude: ["work/**", "node_modules/**"],
    fileParallelism: false,
    maxWorkers: 1,
    testTimeout: 20000,
    hookTimeout: 30000,
  },
});
