import { ALL_FORMATS, BufferSource, Input } from "mediabunny";

export async function recordedDuration(bytes: Uint8Array): Promise<number> {
  const input = new Input({ source: new BufferSource(bytes), formats: ALL_FORMATS });
  try {
    const duration = await input.computeDuration();
    if (!Number.isFinite(duration) || duration <= 0 || duration > 180)
      throw new Error("Recorded media duration is invalid");
    return Math.round(duration * 1000) / 1000;
  } finally { input.dispose(); }
}
