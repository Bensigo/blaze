import { afterEach, expect, it, vi } from "vitest";
vi.mock("../src/lib/db", () => ({ list: async () => [], query: async () => [] }));
vi.mock("../src/lib/analytics", () => ({ analytics: async () => ({}) }));
vi.mock("../src/lib/measurements", () => ({ measurementResults: async () => [] }));
vi.mock("../src/lib/neon-auth", () => ({ googleAvailable: () => false }));
vi.mock("../src/lib/social-oauth", () => ({ socialConfiguration: () => [] }));
vi.mock("../src/lib/db-capacity", () => ({ databaseUsage: async () => undefined }));
import { snapshot } from "../src/lib/workspace";
const owner = { id:"test", workspace_id:"ws", name:"Owner", email:"test@example.test" };
afterEach(() => vi.unstubAllEnvs());
it("reports missing production storage as unconfigured on any host, but permits local development", async () => {
  vi.stubEnv("VERCEL", undefined); vi.stubEnv("BLOB_READ_WRITE_TOKEN", undefined); vi.stubEnv("NODE_ENV", "production");
  expect((await snapshot(owner)).system.storage).toBe(false);
  vi.stubEnv("BLOB_READ_WRITE_TOKEN", "private-token");
  expect((await snapshot(owner)).system.storage).toBe(true);
  vi.stubEnv("BLOB_READ_WRITE_TOKEN", undefined); vi.stubEnv("NODE_ENV", "development");
  expect((await snapshot(owner)).system.storage).toBe(true);
});
