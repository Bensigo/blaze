import { describe, expect, it, vi } from "vitest";
import { readSiteObservability } from "../src/lib/site-observability";
const token = "a-private-token-at-least-32-characters-long";
const env = {NODE_ENV:"test" as const,SITE_HEALTH_URL:"https://collector.example/health",SITE_HEALTH_TOKEN:token,SITE_HEALTH_WORKSPACE_ID:"owner"};
const resolve = vi.fn(async () => [{address:"8.8.8.8",family:4}]);
function report() { const now=new Date().toISOString(); return {schemaVersion:1,generatedAt:now,window:{days:14,since:new Date(Date.now()-86400000).toISOString(),until:now},summary:{sessions:2,gameViewSessions:2,playClickSessions:1,readySessions:1,startedSessions:1,actionSessions:1,noPlaySessions:1,errorSessions:0},funnel:[],games:[],errors:[],delivery:{pending:0,dropped:0,writeFailures:0},recent:[],limitations:[]}; }
describe("generic site health bridge", () => {
  it("binds access to a single workspace before DNS or transport", async () => {
    const dns=vi.fn(resolve); const transport=vi.fn();
    expect((await readSiteObservability("other",{env,resolve:dns,transport})).status).toBe("not_configured");
    expect(dns).not.toHaveBeenCalled(); expect(transport).not.toHaveBeenCalled();
  });
  it("pins public IPv4 and strips unexpected fields", async () => {
    const transport=vi.fn(async () => ({status:200,body:JSON.stringify({...report(),privateField:"hidden"})}));
    const result=await readSiteObservability("owner",{env,resolve,transport});
    expect(result.status).toBe("connected"); expect(JSON.stringify(result)).not.toContain("hidden");
    expect(transport).toHaveBeenCalledWith(new URL(env.SITE_HEALTH_URL),"8.8.8.8",token);
  });
  it("denies unsafe endpoints and DNS results before sending credentials", async () => {
    for (const url of ["http://collector.example/health","https://localhost/health","https://127.0.0.1/health","https://user:password@collector.example/health","https://collector.example/health?token=x","https://collector.example:8443/health"]) {
      const transport=vi.fn(); expect((await readSiteObservability("owner",{env:{...env,SITE_HEALTH_URL:url},resolve,transport})).status).toBe("unavailable"); expect(transport).not.toHaveBeenCalled();
    }
    const transport=vi.fn(); expect((await readSiteObservability("owner",{env,resolve:async () => [{address:"8.8.8.8",family:4},{address:"10.0.0.1",family:4}],transport})).status).toBe("unavailable"); expect(transport).not.toHaveBeenCalled();
  });
  it("rejects redirects, malformed, stale and credential-bearing responses without disclosing details", async () => {
    for (const response of [{status:302,body:""},{status:200,body:JSON.stringify({...report(),limitations:[token]})},{status:200,body:JSON.stringify({...report(),generatedAt:"2020-01-01T00:00:00Z"})},{status:200,body:"x".repeat(262145)}]) {
      const result=await readSiteObservability("owner",{env,resolve,transport:async () => response}); expect(result.status).toBe("unavailable"); expect(JSON.stringify(result)).not.toContain(token);
    }
  });
});
