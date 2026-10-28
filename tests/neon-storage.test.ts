import { beforeEach, describe, expect, it, vi } from 'vitest';
const h=vi.hoisted(()=>({records:new Map<string, any>(), calls:[] as string[], size:8, type:'video/webm', prefix:Buffer.from([0x1a,0x45,0xdf,0xa3,0,0,0,0]), counter:0, failMedia:false, failFinalRemove:false, failDelete:false}));
vi.mock('../src/lib/db',()=>({
  id:(prefix:string)=>`${prefix}_${(++h.counter).toString(16).padStart(32,'0')}`,
  get:async (ws:string,k:string,id:string)=>h.records.get(`${ws}:${k}:${id}`),
  put:async (ws:string,k:string,v:any)=>{h.calls.push(`put:${k}`); if(k==='media' && h.failMedia) throw Error('db failure'); h.records.set(`${ws}:${k}:${v.id}`,JSON.parse(JSON.stringify(v)));},
  comparePut:async (ws:string,k:string,old:any,next:any)=>{const key=`${ws}:${k}:${old.id}`; if(JSON.stringify(h.records.get(key))!==JSON.stringify(JSON.parse(JSON.stringify(old)))) return false; h.records.set(key,JSON.parse(JSON.stringify(next))); return true;},
  remove:async (ws:string,k:string,id:string)=>{if(h.failFinalRemove && k==='media_storage_intent' && id.startsWith('media_')) throw Error('pointer remove failed');h.records.delete(`${ws}:${k}:${id}`)},
  query:async (sql:string,args:any[]=[])=>{
    if(sql.startsWith('INSERT INTO records') && sql.includes("'media'")) { h.calls.push('put:media'); if(h.failMedia) throw Error('db failure'); const key=`${args[0]}:media:${args[1]}`; if(!h.records.has(key)) h.records.set(key,JSON.parse(args[2])); return []; }
    if(sql.startsWith('UPDATE records SET body=jsonb_set')) { const key=`${args[0]}:media:${args[1]}`, record=h.records.get(key); if(!record) return []; const updated={...record,deletedAt:args[2]}; h.records.set(key,updated); return [{body:updated}]; }
    if(sql.includes("WHERE kind='media' AND id=$1")) { const found=[...h.records.entries()].find(([key,body])=>key.endsWith(`:media:${args[0]}`) && !body.deletedAt); return found?[{workspace_id:found[0].split(':')[0],body:found[1]}]:[]; }
    return [...h.records.entries()].filter(([key])=>key.includes(':media_storage_intent:')).map(([key,body])=>({workspace_id:key.split(':')[0],body}));
  },
}));
vi.mock('../src/lib/jobs',()=>({activeJob:async()=>({workspace_id:'ws1',kind:'recording'})}));
vi.mock('../src/lib/neon-storage',()=>({neonStorageSelected:()=>true,neonStorageConfigured:()=>true,neonUploadUrl:async()=>{h.calls.push('sign');return 'https://storage.test/put'},neonCopy:async()=>{h.calls.push('copy')},neonHead:async()=>({ContentLength:h.size,ContentType:h.type}),neonRead:async()=>({ContentLength:Math.min(16,h.size),ContentRange:`bytes 0-${Math.min(16,h.size)-1}/${h.size}`,Body:{async *[Symbol.asyncIterator](){yield h.prefix;}}}),neonPut:async()=>{},neonDelete:async(key:string)=>{h.calls.push(`delete:${key}`); if(h.failDelete) throw Error('storage delete failed')},neonDownloadUrl:async()=> 'https://storage.test/get'}));
import { POST } from '../src/app/api/worker/neon-upload/route';
import { cleanupStorageIntents, deleteAsset, mediaRecord, lookupMedia, serveMedia } from '../src/lib/media';
function req(body:unknown, token='worker-secret'){return new Request('https://app.test/api/worker/neon-upload',{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(body)})}
describe('private worker uploads',()=>{
  beforeEach(()=>{h.records.clear();h.calls=[];h.counter=0;h.size=8;h.type='video/webm';h.prefix=Buffer.from([0x1a,0x45,0xdf,0xa3,0,0,0,0]);h.failMedia=false;h.failFinalRemove=false;h.failDelete=false;vi.stubEnv('WORKER_TOKEN','worker-secret')});
  it('authorizes a staging capability only after durable cleanup, copies and validates before registering, and is idempotent',async()=>{
    expect((await POST(req({action:'reserve',recordingId:'r',kind:'video',size:8},'wrong'))).status).toBe(401);
    const reserve=await POST(req({action:'reserve',recordingId:'r',kind:'video',size:8})); const data=await reserve.json();
    expect(reserve.status).toBe(200); expect(h.calls.indexOf('put:media_storage_intent')).toBeLessThan(h.calls.indexOf('sign'));
    const finalize={action:'finalize',recordingId:'r',intentId:data.intentId};
    const done=await POST(req(finalize)); expect(done.status).toBe(200); const result=await done.json();
    expect(h.calls.indexOf('copy')).toBeLessThan(h.calls.indexOf('put:media'));
    expect(result.url).toMatch(/^\/api\/media\/media_/);
    expect(await (await POST(req(finalize))).json()).toEqual(result);
    expect(h.calls.filter(x=>x==='copy')).toHaveLength(1);
  });
  it('refuses a mismatched final object and retains its cleanup pointer',async()=>{
    const data=await (await POST(req({action:'reserve',recordingId:'r',kind:'video',size:8}))).json(); h.size=9;
    expect((await POST(req({action:'finalize',recordingId:'r',intentId:data.intentId}))).status).toBe(400);
    expect(h.calls).not.toContain('put:media'); expect([...h.records.keys()].filter(k=>k.includes('media_storage_intent'))).toHaveLength(2);
  });
  it('recovers registration after a database failure without copying again',async()=>{
    const data=await (await POST(req({action:'reserve',recordingId:'r',kind:'video',size:8}))).json(); const finish={action:'finalize',recordingId:'r',intentId:data.intentId}; h.failMedia=true;
    expect((await POST(req(finish))).status).toBe(500); h.failMedia=false;
    expect((await POST(req(finish))).status).toBe(200); expect(h.calls.filter(x=>x==='copy')).toHaveLength(1);
  });
  it('rejects mismatched job references and invalid media bytes',async()=>{
    const data=await (await POST(req({action:'reserve',recordingId:'r',kind:'video',size:8}))).json();
    expect((await POST(req({action:'finalize',recordingId:'other',intentId:data.intentId}))).status).toBe(400);
    h.prefix=Buffer.alloc(8);
    expect((await POST(req({action:'finalize',recordingId:'r',intentId:data.intentId}))).status).toBe(400);
    expect(h.calls).not.toContain('put:media');
  });
  it('does not resurrect a deleted finalized asset on retry',async()=>{
    const data=await (await POST(req({action:'reserve',recordingId:'r',kind:'video',size:8}))).json(); const finish={action:'finalize',recordingId:'r',intentId:data.intentId};
    const result=await (await POST(req(finish))).json(); const mid=result.url.split('/').pop();
    h.records.delete(`ws1:media:${mid}`);
    expect((await POST(req(finish))).status).toBe(410);
  });

  it('cleanup recovers a completed upload even when staging is reaped first',async()=>{
    const data=await (await POST(req({action:'reserve',recordingId:'r',kind:'video',size:8}))).json(); h.failMedia=true;
    expect((await POST(req({action:'finalize',recordingId:'r',intentId:data.intentId}))).status).toBe(500); h.failMedia=false;
    expect(await cleanupStorageIntents()).toEqual({checked:2,failed:0});
    expect([...h.records.keys()].some(key=>key.includes(':media:media_'))).toBe(true);
  });

  it('never restores an intentionally deleted object when final pointer removal failed',async()=>{
    const data=await (await POST(req({action:'reserve',recordingId:'r',kind:'video',size:8}))).json(); const finish={action:'finalize',recordingId:'r',intentId:data.intentId}; h.failFinalRemove=true;
    const result=await (await POST(req(finish))).json(); const mid=result.url.split('/').pop();
    expect(h.records.has(`ws1:media_storage_intent:${mid}`)).toBe(true);
    const staleRecord={...h.records.get(`ws1:media:${mid}`)};
    h.failDelete=true;
    await expect(deleteAsset('ws1',result.url)).rejects.toThrow('storage delete failed');
    const deleted=h.records.get(`ws1:media:${mid}`);
    expect(deleted.deletedAt).toBeTruthy();
    expect(await mediaRecord('ws1',mid)).toBeUndefined();
    expect(await lookupMedia(mid)).toBeUndefined();
    expect((await serveMedia(deleted,new Request('https://app.test/'))).status).toBe(410);
    expect((await serveMedia(staleRecord,new Request('https://app.test/'))).status).toBe(410);
    expect((await POST(req(finish))).status).toBe(410);
    h.failDelete=false;
    await deleteAsset('ws1',result.url);
    h.failFinalRemove=false;
    expect(await cleanupStorageIntents()).toEqual({checked:2,failed:0});
    expect(await mediaRecord('ws1',mid)).toBeUndefined();
    expect(h.records.get(`ws1:media:${mid}`).deletedAt).toBeTruthy();
    expect(h.calls.filter(x=>x==='copy')).toHaveLength(1);
  });

});
