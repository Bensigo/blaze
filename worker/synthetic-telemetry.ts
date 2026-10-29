/** The controlled decision lab is deliberately telemetry-free. */
export function usesSyntheticTelemetry(recording: {
  targetProvenance?: string;
}): boolean {
  return recording.targetProvenance !== "controlled_lab";
}
export async function emitSyntheticEvent(
  recording: { targetProvenance?: string },
  send: () => Promise<unknown>,
): Promise<void> {
  if (usesSyntheticTelemetry(recording)) await send();
}
