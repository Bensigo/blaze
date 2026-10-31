import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
const {tick}=vi.hoisted(()=>({tick:vi.fn()}));
vi.mock("../src/lib/content-service",()=>({tickContentService:tick}));
// @ts-expect-error Netlify's native .mts entry is compiled by Vitest.
import scheduled from "../netlify/functions/blaze-content-watchdog.mts";
beforeEach(()=>{vi.resetAllMocks();vi.stubEnv("BLAZE_CLOUD_WATCHDOG_SCHEDULE_ENABLED","true");vi.stubEnv("BLAZE_CLOUD_WATCHDOG_ENABLED","true");vi.stubEnv("BLAZE_CLOUD_WATCHDOG_WORKSPACE_ID","owner-workspace");vi.stubEnv("SITE_ID","69282a07-4d13-4882-8bf4-d9fddedf54d4");vi.stubEnv("URL","https://blaze-bensigo.netlify.app");vi.stubEnv("CONTEXT",undefined);});
afterEach(()=>vi.unstubAllEnvs());
describe("actual Netlify runtime monitor admission",()=>{
 it("runs once with reserved runtime identity and no build-only CONTEXT",async()=>{expect((await scheduled()).status).toBe(204);expect(tick).toHaveBeenCalledExactlyOnceWith("owner-workspace");});
 it("stays inert when the production-only opt-in is absent",async()=>{vi.stubEnv("BLAZE_CLOUD_WATCHDOG_SCHEDULE_ENABLED",undefined);expect((await scheduled()).status).toBe(204);expect(tick).not.toHaveBeenCalled();});
 it.each([["SITE_ID","different-site"],["SITE_ID",undefined],["URL","https://preview--blaze-bensigo.netlify.app"],["URL","https://blaze-bensigo.netlify.app/?next=elsewhere"],["CONTEXT","deploy-preview"],["BLAZE_CLOUD_WATCHDOG_ENABLED","false"],["BLAZE_CLOUD_WATCHDOG_WORKSPACE_ID","bad\nworkspace"]])("rejects invalid runtime boundary %s=%s",async(key,value)=>{vi.stubEnv(key,value);await expect(scheduled()).rejects.toThrow();expect(tick).not.toHaveBeenCalled();});
 it("does not hide or retry a failed service invocation",async()=>{tick.mockRejectedValueOnce(Error("fixture service failure"));await expect(scheduled()).rejects.toThrow("fixture service failure");expect(tick).toHaveBeenCalledOnce();});
});
