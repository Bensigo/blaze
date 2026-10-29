import { expect, it, vi } from "vitest";
import {
  emitSyntheticEvent,
  usesSyntheticTelemetry,
} from "../worker/synthetic-telemetry";

it("skips every worker telemetry emission for the controlled lab only", async () => {
  const send = vi.fn().mockResolvedValue({});
  for (const _event of [
    "visit",
    "loaded",
    "first_action",
    "progression",
    "exit",
    "error",
  ])
    await emitSyntheticEvent({ targetProvenance: "controlled_lab" }, send);
  expect(send).not.toHaveBeenCalled();
  expect(usesSyntheticTelemetry({ targetProvenance: "controlled_lab" })).toBe(
    false,
  );
  await emitSyntheticEvent({}, send);
  expect(send).toHaveBeenCalledTimes(1);
  await expect(
    emitSyntheticEvent({}, async () => {
      throw new Error("event failed");
    }),
  ).rejects.toThrow("event failed");
});
