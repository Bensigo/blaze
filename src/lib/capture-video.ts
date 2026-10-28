import { Input, BufferSource, WEBM, MP4 } from "mediabunny";
import { HttpError } from "./auth";
export async function inspectCaptureVideo(
  bytes: Uint8Array,
  maxDuration: number,
) {
  const input = new Input({
    source: new BufferSource(bytes),
    formats: [WEBM, MP4],
  });
  try {
    const tracks = await input.getVideoTracks(),
      audio = await input.getAudioTracks();
    if (tracks.length !== 1 || audio.length)
      throw new HttpError(
        400,
        "A session recording must contain one silent video track.",
      );
    const video = tracks[0];
    const [width, height, rotation, start, end, stats] = await Promise.all([
      video.getDisplayWidth(),
      video.getDisplayHeight(),
      video.getRotation(),
      video.getFirstTimestamp(),
      video.computeDuration(),
      video.computePacketStats(),
    ]);
    const duration = end - start;
    // A capture can include both boundary frames (at t=0 and t=duration).
    // Packet count / duration overstates its frame rate, especially for short clips.
    const fps = Math.max(0, stats.packetCount - 1) / duration;
    if (
      !Number.isFinite(duration) ||
      duration <= 0 ||
      duration > maxDuration + 0.25 ||
      width < 1 ||
      height < 1 ||
      width > 960 ||
      height > 540 ||
      rotation !== 0 ||
      !Number.isFinite(fps) ||
      fps > 5.5 ||
      stats.packetCount > Math.ceil(duration * 5) + 2
    )
      throw new HttpError(
        400,
        "The recorded video exceeds its duration, resolution or sampling limit.",
      );
    return {
      width,
      height,
      durationSeconds: duration,
      fps,
      contentType: await input.getMimeType(),
    };
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(
      400,
      "The recording is not a supported, readable WebM or MP4 video.",
    );
  } finally {
    input.dispose();
  }
}
