import locations from "../data/country-locations.json";
type Row = { name: string; count: number };
const lookup = new Map(locations.flatMap(row => [[row.code, row], [row.name.toUpperCase(), row]]));
export function countrySegments(rows: Row[]) {
  const segments = new Map<string, { code: string; name: string; count: number; location: [number, number] }>();
  let unknown = 0;
  for (const row of rows) {
    if (!Number.isFinite(row.count) || row.count <= 0) continue;
    const country = lookup.get(row.name.trim().toUpperCase());
    if (!country) { unknown += row.count; continue; }
    const prior = segments.get(country.code);
    segments.set(country.code, { code: country.code, name: country.name, count: (prior?.count || 0) + row.count, location: [country.location[0], country.location[1]] });
  }
  const countries = [...segments.values()].sort((a,b) => b.count-a.count || a.name.localeCompare(b.name));
  return { countries, unknown, total: countries.reduce((sum,c) => sum+c.count,unknown) };
}
