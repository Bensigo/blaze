import { beforeEach, describe, expect, it, vi } from 'vitest';

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
  unlink:async()=>{h.calls.push('unlink');if(h.failUnlink)throw Error('delete failed');},readFile:async()=>Buffer.alloc(0),
}));
import { cleanupStorageIntents, saveAsset } from '../src/lib/media';

describe('durable media cleanup intent',()=>{
  beforeEach(()=>{h.records.clear();h.calls=[];h.failPut=true;h.failUnlink=true;});
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
});
