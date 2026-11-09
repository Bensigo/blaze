import {expect,it} from "vitest";
import {dashboardHref,readDashboardLocation} from "../src/lib/dashboard-location";
it("retains a known workspace view, game and date range across reload",()=>{
  const location=readDashboardLocation("?view=discovery&game=game_one&days=30",["game_one"]);
  expect(location).toEqual({page:"discovery",gameId:"game_one",days:"30"});
  expect(readDashboardLocation(dashboardHref(location).split("?")[1],["game_one"])).toEqual(location);
});
it("does not navigate to unknown views or games outside the loaded workspace",()=>{
  expect(readDashboardLocation("?view=https://evil.example&game=other_owner&days=999",["mine"])).toEqual({page:"overview",gameId:"all",days:"7"});
  expect(readDashboardLocation("?view=games&game=../private",["mine"]).gameId).toBe("all");
});
it("canonical URLs contain only UI state and omit auth callback values",()=>{
  const location=readDashboardLocation("?view=games&token=private&neon_auth_session_verifier=private&auth=failed",[]);
  expect(dashboardHref(location)).toBe("/app?view=games");
  expect(dashboardHref({page:"overview",gameId:"all",days:"7"})).toBe("/app");
});

it("redirects retired views to the overview",()=>{
  for (const view of ["content", "recordings", "calendar"]) expect(readDashboardLocation(`?view=${view}`).page).toBe("overview");
});

it("preserves legacy Forever health links while using the canonical Site health URL",()=>{
  const location=readDashboardLocation("?view=forever&days=14");
  expect(location).toEqual({page:"site",gameId:"all",days:"14"});
  expect(dashboardHref(location)).toBe("/app?view=site&days=14");
});
it("round-trips focused analytics views",()=>{
  for (const page of ["analytics", "acquisition", "retention", "audience"] as const) {
    const location = { page, gameId: "game_one", days: "30" };
    expect(readDashboardLocation(dashboardHref(location).split("?")[1], ["game_one"])).toEqual(location);
  }
});
