import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import ffmpeg from "ffmpeg-static";
import { inspectProducedVideo } from "../src/lib/content-studio";
import { DEFAULT_VIDEO_SETTINGS } from "../src/lib/content-studio-contract";
describe("actual encoded producer media validation", () => {
  it("checks an encoded H264 MP4, exact format and duration, and required audio", async () => {
    // Deliberately synthetic media for parser validation only. This is never gameplay evidence.
    const result = spawnSync(ffmpeg!, ["-v", "error", "-f", "lavfi", "-i", "color=blue:s=360x640:r=15:d=10", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-movflags", "frag_keyframe+empty_moov", "-f", "mp4", "pipe:1"], { maxBuffer: 4 * 1024 * 1024 });
    if (result.status !== 0) throw new Error(result.stderr.toString());
    const settings = { ...DEFAULT_VIDEO_SETTINGS, durationSeconds: 10, music: "none" as const };
    expect(await inspectProducedVideo(result.stdout, { settings })).toMatchObject({ width: 360, height: 640, audioTracks: 0 });
    await expect(inspectProducedVideo(result.stdout, { settings: { ...settings, gameAudio: true } })).rejects.toThrow("approved settings");
    await expect(inspectProducedVideo(result.stdout, { settings: { ...settings, aspectRatio: "16:9" } })).rejects.toThrow("approved settings");
    await expect(inspectProducedVideo(result.stdout, { settings: { ...settings, durationSeconds: 30 } })).rejects.toThrow("approved settings");
  });
});
