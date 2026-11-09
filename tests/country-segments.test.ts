import { expect, it } from "vitest";
import { countrySegments } from "../src/lib/country-segments";
it("maps only actual measured countries and keeps unknowns without inventing locations",()=>{
 const r=countrySegments([{name:'NG',count:3},{name:'Nigeria',count:2},{name:'GB',count:1},{name:'Unknown',count:4},{name:'private-location',count:2},{name:'US',count:0}]);
 expect(r.total).toBe(12);expect(r.unknown).toBe(6);expect(r.countries.map(c=>[c.code,c.count])).toEqual([['NG',5],['GB',1]]);expect(r.countries[0].location).toHaveLength(2);
});
