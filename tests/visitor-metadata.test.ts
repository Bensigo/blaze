import { afterEach, describe, expect, it, vi } from "vitest";

const context = vi.hoisted(() => vi.fn());
vi.mock("@netlify/functions", () => ({ getContext: context }));
import { visitorMetadata } from "../src/lib/visitor-metadata";

const request = new Request("https://example.test/api/collect", {
  headers: {
    "x-forwarded-for": "192.0.2.8",
    "x-vercel-ip-country": "US",
    "x-nf-client-connection-ip": "192.0.2.9",
    "x-nf-geo": '{"country":{"code":"US"}}',
  },
});
afterEach(() => { vi.unstubAllEnvs(); context.mockReset(); });

describe("visitor metadata trust boundary", () => {
  it("uses validated Netlify request context and ignores client headers", () => {
    vi.stubEnv("NODE_ENV", "production"); vi.stubEnv("SITE_ID", "site"); vi.stubEnv("VERCEL", "");
    context.mockReturnValue({ ip: "2001:db8::1", geo: { country: { code: "NG" } } });
    expect(visitorMetadata(request)).toEqual({ ip: "2001:db8::1", country: "NG" });
  });
  it("ignores malformed context values instead of falling back to headers", () => {
    vi.stubEnv("NODE_ENV", "production"); vi.stubEnv("SITE_ID", "site"); vi.stubEnv("VERCEL", "");
    context.mockReturnValue({ ip: "192.0.2.1, 192.0.2.2", geo: { country: { code: "NG,US" } } });
    expect(visitorMetadata(request)).toEqual({ ip: "unknown", country: "Unknown" });
  });
  it("uses a shared unknown bucket if context is unavailable", () => {
    vi.stubEnv("NODE_ENV", "production"); vi.stubEnv("SITE_ID", "site"); vi.stubEnv("VERCEL", "");
    context.mockImplementation(() => { throw new Error("no request"); });
    expect(visitorMetadata(request)).toEqual({ ip: "unknown", country: "Unknown" });
  });
  it("never reads context for local or unrecognized hosts", () => {
    vi.stubEnv("VERCEL", ""); vi.stubEnv("SITE_ID", "site"); vi.stubEnv("NODE_ENV", "development");
    expect(visitorMetadata(request)).toEqual({ ip: "unknown", country: "Unknown" });
    vi.stubEnv("NODE_ENV", "production"); vi.stubEnv("SITE_ID", "");
    expect(visitorMetadata(request)).toEqual({ ip: "unknown", country: "Unknown" });
    expect(context).not.toHaveBeenCalled();
  });
  it("preserves Vercel behavior and ignores Netlify context", () => {
    vi.stubEnv("VERCEL", "1");
    expect(visitorMetadata(request)).toEqual({ ip: "192.0.2.8", country: "US" });
    expect(context).not.toHaveBeenCalled();
  });
});
