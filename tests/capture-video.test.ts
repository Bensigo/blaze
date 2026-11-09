import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import ffmpeg from 'ffmpeg-static';
import { inspectCaptureVideo } from '../src/lib/capture-video';

function generate(size='320x180', rate=5, audio=false) {
  const args=['-v','error','-f','lavfi','-i',`color=red:s=${size}:r=${rate}:d=1`];
  if(audio) args.push('-f','lavfi','-i','sine=frequency=1000:duration=1');
  args.push('-c:v','libvpx','-deadline','realtime','-cpu-used','8');
  if(audio) args.push('-c:a','libopus');
  args.push('-shortest','-f','webm','pipe:1');
  const result=spawnSync(ffmpeg!,args,{maxBuffer:2*1024*1024});
  if(result.status!==0) throw result.error || Error(result.stderr?.toString() || 'ffmpeg failed');
  return result.stdout;
}
describe('actual capture video inspection',()=>{
  it('accepts an actual silent 5 fps WebM',async()=>{
    const result=await inspectCaptureVideo(generate(),30);
    expect(result.width).toBe(320);expect(result.height).toBe(180);
    expect(result.fps).toBeLessThanOrEqual(5.5);expect(result.durationSeconds).toBeLessThanOrEqual(1.25);
  });
  it('rejects video with audio, high frame rate, excessive dimensions and invalid media',async()=>{
    await expect(inspectCaptureVideo(generate('320x180',5,true),30)).rejects.toThrow(/silent/);
    await expect(inspectCaptureVideo(generate('320x180',30),30)).rejects.toThrow(/sampling/);
    await expect(inspectCaptureVideo(generate('962x542',5),30)).rejects.toThrow(/resolution/);
    await expect(inspectCaptureVideo(new Uint8Array([0x1a,0x45,0xdf,0xa3]),30)).rejects.toThrow(/readable/);
  });
});
