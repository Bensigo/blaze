import { describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ query: vi.fn(), rateLimit: vi.fn(), usage: vi.fn() }));
vi.mock("../src/lib/db", () => ({ query: mocks.query, rateLimit: mocks.rateLimit }));
vi.mock("../src/lib/db-capacity", () => ({ databaseUsage: mocks.usage }));
import { ingest } from "../src/lib/telemetry";
const game = { id:"game", title:"Game", url:"https://game.example/", description:"", image:"", genre:"", sdkKey:"sdk-key-12345678901234567890", origins:["https://game.example"], createdAt:"", dailyEnabled:true, competitors:[] };
const request = () => new Request("https://studio.example/api/collect", { method:"POST", headers:{origin:"https://game.example","content-type":"application/json"}, body:JSON.stringify({sdkKey:game.sdkKey,events:[{id:"event-123",name:"visit",sessionId:"session-123",playerId:"player-123",timestamp:new Date().toISOString(),properties:{},page:"https://game.example/",referrer:""}]}) });
describe("ingest capacity protection",()=>{
  it("returns a no-store 503 without writing for either human or synthetic events",async()=>{
    mocks.query.mockReset();mocks.rateLimit.mockReset();mocks.usage.mockResolvedValue({bytes:800,limitBytes:1000,paused:true,measuredAt:new Date().toISOString(),retentionDays:null});
    mocks.query.mockResolvedValue([{workspace_id:"ws",body:game}]);
    const human=await ingest(request());expect(human.status).toBe(503);expect(human.headers.get("access-control-allow-origin")).toBe("https://game.example");expect(human.headers.get("retry-after")).toBe("30");
    const synthetic=await ingest(request(),{workspace:"ws",game,recordingId:"rec-1"});expect(synthetic.status).toBe(503);
    expect(mocks.rateLimit).not.toHaveBeenCalled();expect(mocks.query.mock.calls.every(([sql])=>!sql.includes("INSERT INTO events"))).toBe(true);
  });
});
