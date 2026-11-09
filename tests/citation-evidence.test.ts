import { describe, expect, it } from "vitest";
import { validateCitationEvidence } from "../src/lib/citation-evidence";
import type { Game } from "../src/lib/types";
const game = {id:"g",url:"https://example.com/game"} as Game;
const row = {page:game.url,startDate:"2026-01-01",endDate:"2026-01-31",citations:5,confirmed:true};
describe("owner-reported citation evidence", () => {
  it("labels the source and retains only an exact-page report", () => expect(validateCitationEvidence(game,row)).toMatchObject({source:"Owner-reported Bing AI Performance",citations:5,page:game.url}));
  it("rejects unrelated, query-bearing, malformed and unconfirmed evidence", () => { for (const patch of [{page:"https://example.com/other"},{page:"https://example.com/game?token=private"},{citations:-1},{startDate:"2026-02-30"},{confirmed:false}]) expect(() => validateCitationEvidence(game,{...row,...patch})).toThrow(); });
});
