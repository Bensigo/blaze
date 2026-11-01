import {describe,it,expect} from "vitest";
import {buildCloudRuntimePreflight} from "../src/lib/cloud-runtime-preflight";
describe("approved cloud runtime probe",()=>{
 it("scopes each production to its own source, frames and permitted resources",()=>{
  const result=buildCloudRuntimePreflight({url:"https://game.example/play?token=removed",networkPolicy:{resourceOrigins:["https://assets.example"],frameUrls:["https://frame.example/game"]}});
  expect(result.targets).toEqual(["https://game.example/play","https://frame.example/game"]);
  expect(result.hosts).toEqual(["game.example","frame.example","assets.example"]);
  expect(result.program).not.toContain("forever.africa");expect(result.program).not.toContain("token=removed");
  expect(result.program).not.toContain("__BLAZE_");
 });
 it("rejects HTTP or credential-bearing probe targets before paid dispatch",()=>{
  for(const url of ["http://game.example/play","https://user:password@game.example/play"])expect(()=>buildCloudRuntimePreflight({url,networkPolicy:{resourceOrigins:[]}})).toThrow("Invalid approved HTTPS");
 });
});
