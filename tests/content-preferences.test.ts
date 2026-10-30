import {beforeAll,beforeEach,describe,expect,it,vi} from "vitest";
let db:typeof import("../src/lib/db");let preferences:typeof import("../src/lib/content-preferences");
beforeAll(async()=>{delete process.env.DATABASE_URL;delete process.env.VERCEL;process.env.LOCAL_DATABASE_PATH="memory://";db=await import("../src/lib/db");preferences=await import("../src/lib/content-preferences");});
beforeEach(async()=>{await db.query("DELETE FROM records");});
describe("suggestion feedback",()=>{
 it("preserves scoped rejection history idempotently without deleting scripts or active videos",async()=>{
 const fetch=vi.fn();vi.stubGlobal("fetch",fetch);
 await db.put("ws","content_idea",{id:"idea",gameId:"dog",sourceRevision:"source",title:"An angle",treatment:"Show a control"});
 await db.put("ws","content_script",{id:"script",ideaId:"idea",text:"Keep this script"});
 await db.put("ws","video_production",{id:"unstarted",ideaId:"idea",state:"approved"});await db.put("ws","video_production",{id:"active",ideaId:"idea",state:"running"});
 await db.put("ws","script_review",{id:"review",scriptId:"script",state:"approved"});
 const first=await preferences.rejectContentIdea("ws","owner","idea","Not this angle");expect(await preferences.rejectContentIdea("ws","owner","idea")).toEqual(first);
 expect(await preferences.contentRejections("ws","dog")).toHaveLength(1);expect(await preferences.contentRejections("other","dog")).toEqual([]);
 expect(await db.get("ws","content_script","script")).toMatchObject({text:"Keep this script"});expect(await db.get("ws","video_production","active")).toMatchObject({state:"running"});expect(await db.get("ws","video_production","unstarted")).toMatchObject({state:"failed"});expect(await db.get("ws","script_review","review")).toMatchObject({state:"failed"});
 await expect(preferences.rejectContentIdea("other","owner","idea")).rejects.toThrow("not found");expect(fetch).not.toHaveBeenCalled();vi.unstubAllGlobals();
 });
});
