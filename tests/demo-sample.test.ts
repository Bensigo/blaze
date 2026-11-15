import { describe, expect, it } from "vitest";
import { buildDemo, demoSessionEvents } from "../src/lib/demo";

describe("example workspace", () => {
  it.each([7, 14, 30])("provides coherent sample activity for %s days", (days) => {
    const analytics = buildDemo(undefined, days).analytics!;
    expect(analytics.campaigns.length).toBeGreaterThan(0);
    expect(analytics.retention.reduce((sum, row) => sum + row.returned, 0)).toBeGreaterThan(0);
    const session = analytics.sessionsList[0];
    expect(session).toBeDefined();
    const events = demoSessionEvents(session.id, session.gameId, days);
    expect(events.length).toBeGreaterThan(0);
    expect(events.every((event) => event.sessionId === session.id && event.gameId === session.gameId)).toBe(true);
    expect(demoSessionEvents(session.id, "other-game", days)).toEqual([]);
  });
});
