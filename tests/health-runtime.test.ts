import {afterEach,expect,it,vi} from "vitest";
vi.mock("../src/lib/db",()=>({query:vi.fn(async()=>[])}));
import {GET} from "../src/app/api/health/route";
import {query} from "../src/lib/db";
afterEach(()=>{vi.unstubAllEnvs();vi.mocked(query).mockResolvedValue([]);});
it("reports health and release without exposing secrets or retired automation",async()=>{
  vi.stubEnv("BLAZE_CLOUD_PRODUCTION_ENABLED","false");vi.stubEnv("BLAZE_CLOUD_PILOT_ENABLED","true");vi.stubEnv("CREDENTIAL_KEY","must-never-be-returned");vi.stubEnv("NEXT_PUBLIC_BLAZE_RELEASE_SHA","a".repeat(40));
  const r=await GET();const body=await r.json();
  expect(body).not.toHaveProperty("automation");expect(body.status).toBe("ok");expect(body.release).toBe("a".repeat(40));expect(JSON.stringify(body)).not.toContain("must-never-be-returned");expect(r.headers.get("cache-control")).toBe("no-store");
});
it("reports unavailable database without private error details or invalid release stamps",async()=>{
  vi.stubEnv("BLAZE_CLOUD_PILOT_ENABLED","false");vi.stubEnv("NEXT_PUBLIC_BLAZE_RELEASE_SHA","not-a-release");vi.mocked(query).mockRejectedValueOnce(Error("private connection detail"));
  const r=await GET();const body=await r.json();expect(r.status).toBe(503);expect(body.release).toBeNull();expect(body).not.toHaveProperty("automation");expect(JSON.stringify(body)).not.toContain("private connection detail");
});
