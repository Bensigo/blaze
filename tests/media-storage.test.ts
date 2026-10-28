import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h=vi.hoisted(()=>({records:new Map<string,any>(),calls:[] as string[],failPut:true,failUnlink:true}));
vi.mock('../src/lib/db',()=>({
  id:()=> 'media_test',
  put:async (_ws:string,kind:string,value:any)=>{h.calls.push(`put:${kind}`);if(kind==='media'&&h.failPut)throw Error('metadata failed');h.records.set(`${kind}:${value.id}`,value);},
  get:async (_ws:string,kind:string,id:string)=>h.records.get(`${kind}:${id}`),
  remove:async (_ws:string,kind:string,id:string)=>{h.calls.push(`remove:${kind}`);h.records.delete(`${kind}:${id}`)},
  query:async ()=>[...h.records.entries()].filter(([key])=>key.startsWith('media_storage_intent:')).map(([,body])=>({workspace_id:'ws_test',body})),
}));
vi.mock('node:fs/promises',()=>({
  mkdir:async()=>{},writeFile:async()=>{h.calls.push('write');},
  unlink:async()=>{h.calls.push('unlink');if(h.failUnlink)throw Error('delete failed');},readFile:async()=>{h.calls.push('read');return Buffer.alloc(0);},
}));
import { cleanupStorageIntents, deleteAsset, mediaBytes, mediaStorageConfigured, saveAsset, serveMedia } from '../src/lib/media';

describe('durable media cleanup intent',()=>{
  beforeEach(()=>{h.records.clear();h.calls=[];h.failPut=true;h.failUnlink=true;});
  afterEach(()=>vi.unstubAllEnvs());
  it('keeps a pointer if metadata and immediate deletion fail, and retries later',async()=>{
    const old=process.env.BLOB_READ_WRITE_TOKEN;delete process.env.BLOB_READ_WRITE_TOKEN;
    try {
      const file=new File([new Uint8Array([0x1a,0x45,0xdf,0xa3])],'test.webm',{type:'video/webm'});
      await expect(saveAsset('ws_test','capture_test','session',file,undefined,{captureId:'capture_test'})).rejects.toThrow('metadata failed');
      expect(h.calls.indexOf('put:media_storage_intent')).toBeLessThan(h.calls.indexOf('write'));
      expect(h.records.has('media_storage_intent:media_test')).toBe(true);
      h.failUnlink=false;
      expect(await cleanupStorageIntents()).toEqual({checked:1,failed:0});
      expect(h.records.has('media_storage_intent:media_test')).toBe(false);
    } finally {if(old===undefined)delete process.env.BLOB_READ_WRITE_TOKEN;else process.env.BLOB_READ_WRITE_TOKEN=old;}
  });
  it('fails closed on a non-Vercel production host before any local write or metadata intent',async()=>{
    vi.stubEnv('NODE_ENV','production');vi.stubEnv('VERCEL',undefined);vi.stubEnv('BLOB_READ_WRITE_TOKEN',undefined);
    const file=new File([new Uint8Array([0x1a,0x45,0xdf,0xa3])],'test.webm',{type:'video/webm'});
    expect(mediaStorageConfigured()).toBe(false);
    await expect(saveAsset('ws_test','capture_test','session',file)).rejects.toThrow('Private media storage is not configured');
    expect(h.calls).toEqual([]);expect(h.records.size).toBe(0);
    const local={id:'media_test',recordingId:'r',kind:'video',contentType:'video/webm',size:4,location:'.data/media/ws_test/media_test',backend:'local' as const,createdAt:new Date().toISOString()};
    h.records.set('media:media_test',local);
    await expect(mediaBytes(local)).rejects.toThrow('Private media storage is not configured');
    await expect(serveMedia(local,new Request('https://example.test/'))).rejects.toThrow('Private media storage is not configured');
    await expect(deleteAsset('ws_test','/api/media/media_test')).rejects.toThrow('Private media storage is not configured');
    expect(h.calls).not.toContain('read');expect(h.calls).not.toContain('unlink');
    expect(h.records.has('media:media_test')).toBe(true);
    vi.stubEnv('BLOB_READ_WRITE_TOKEN','configured-private-token');expect(mediaStorageConfigured()).toBe(true);
  });
  it('keeps the local file backend in test and development',async()=>{
    vi.stubEnv('NODE_ENV','test');vi.stubEnv('VERCEL',undefined);vi.stubEnv('BLOB_READ_WRITE_TOKEN',undefined);h.failPut=false;
    const file=new File([new Uint8Array([0x1a,0x45,0xdf,0xa3])],'test.webm',{type:'video/webm'});
    expect(mediaStorageConfigured()).toBe(true);
    expect(await saveAsset('ws_test','capture_test','session',file)).toBe('/api/media/media_test');
    expect(h.calls).toContain('write');expect(h.records.get('media:media_test').backend).toBe('local');
    vi.stubEnv('NODE_ENV','development');expect(mediaStorageConfigured()).toBe(true);
  });

});
