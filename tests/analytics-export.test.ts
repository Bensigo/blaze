import { describe, expect, it, vi } from "vitest";
import { analyticsCsv } from "../src/lib/analytics-export";
import { buildDemo } from "../src/lib/demo";
const auth=vi.hoisted(()=>({workspace:"a"}));
vi.mock("../src/lib/auth",async()=>{const actual=await vi.importActual<typeof import('../src/lib/auth')>("../src/lib/auth");return {...actual,requireIdentity:async()=>({workspace_id:auth.workspace})};});
vi.mock("../src/lib/db",()=>({get:vi.fn(async(workspace:string,_kind:string,id:string)=>workspace==='a'&&id==='owned'?{id}:undefined),rateLimit:vi.fn(async()=>true)}));
vi.mock("../src/lib/analytics",async()=>{const actual=await vi.importActual<typeof import('../src/lib/analytics')>("../src/lib/analytics");return {...actual,analytics:vi.fn(async()=>({ ...buildDemo().analytics }))};});
import { GET } from "../src/app/api/analytics/export/route";
describe("aggregate CSV export",()=>{
 it("quotes labels, neutralizes formulas and excludes private sessions",()=>{
  const a=buildDemo().analytics; a.sources=[{name:' =HYPERLINK("https://example.com")',count:2}];a.sessionsList=[{id:'private-session',playerId:'private-person'}] as typeof a.sessionsList;
  const csv=analyticsCsv(a,{days:14,generatedAt:'2026-11-09T00:00:00Z'});
  expect(csv).toContain("' =HYPERLINK");expect(csv).toContain('""https://example.com""');expect(csv).not.toContain('private-session');expect(csv).not.toContain('private-person');expect(csv).toContain('"eligible","returned","rate"');
 });
 it("scopes requested games to the authenticated workspace and rejects unsupported windows",async()=>{
  expect((await GET(new Request('https://blaze.example/api/analytics/export?gameId=foreign'))).status).toBe(404);
  expect((await GET(new Request('https://blaze.example/api/analytics/export?gameId=owned&days=999'))).status).toBe(400);
  const r=await GET(new Request('https://blaze.example/api/analytics/export?gameId=owned&days=7'));
  expect(r.status).toBe(200);expect(r.headers.get('content-type')).toContain('text/csv');expect(r.headers.get('cache-control')).toBe('private, no-store');
 });
});
