import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "../src/app/api/auth/config/route";
afterEach(()=>vi.unstubAllEnvs());
describe("public auth configuration",()=>{
  it("requires a valid Neon auth URL, signing secret, owner configuration flag and canonical app URL",async()=>{
    vi.stubEnv("APP_URL","http://localhost:3000");vi.stubEnv("NEON_AUTH_BASE_URL","");vi.stubEnv("NEON_AUTH_COOKIE_SECRET","");vi.stubEnv("NEON_AUTH_GOOGLE_CONFIGURED","");
    const read=async()=>await (await GET(new Request("http://localhost:3000/api/auth/config"))).json();
    expect(await read()).toEqual({googleConfigured:false});
    vi.stubEnv("NEON_AUTH_BASE_URL","https://auth.example.test/db/auth");vi.stubEnv("NEON_AUTH_COOKIE_SECRET","12345678901234567890123456789012");
    expect(await read()).toEqual({googleConfigured:false});
    vi.stubEnv("NEON_AUTH_GOOGLE_CONFIGURED","true");expect(await read()).toEqual({googleConfigured:true});
    vi.stubEnv("NEON_AUTH_BASE_URL","http://auth.example.test/db/auth");expect(await read()).toEqual({googleConfigured:false});
    expect((await GET(new Request("http://localhost:3000/api/auth/config"))).headers.get("cache-control")).toBe("no-store");
  });
});
