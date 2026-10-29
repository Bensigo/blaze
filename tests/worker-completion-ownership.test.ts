import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const h=vi.hoisted(()=>({activeJob:vi.fn(),get:vi.fn(),put:vi.fn(),query:vi.fn(),mediaRecord:vi.fn(),validate:vi.fn(),findings:vi.fn()}));
vi.mock('../src/lib/jobs',()=>({activeJob:h.activeJob}));
vi.mock('../src/lib/db',()=>({get:h.get,put:h.put,query:h.query}));
vi.mock('../src/lib/media',()=>({mediaRecord:h.mediaRecord}));
vi.mock('../src/lib/gameplay-evidence',()=>({validateGameplayEvidence:h.validate,gameplayFindings:h.findings}));
vi.mock('../src/lib/game-automation',()=>({queueClipCandidate:vi.fn(),releaseRecordingGate:vi.fn()}));
vi.mock('../src/lib/content-automation',()=>({drainContentAutomation:vi.fn(),queueClipDraft:vi.fn()}));
import { POST } from '../src/app/api/worker/complete/route';
const request=(extra:Record<string,unknown>)=>new Request('http://localhost/api/worker/complete',{method:'POST',headers:{Authorization:'Bearer worker-token','Content-Type':'application/json'},body:JSON.stringify({recordingId:'rec1',status:'failed',error:'adapter_failed',...extra})});
beforeEach(()=>{process.env.WORKER_TOKEN='worker-token';for(const fn of Object.values(h))fn.mockReset();h.activeJob.mockResolvedValue({id:'rec1',kind:'recording',workspace_id:'ws1'});h.get.mockResolvedValue({id:'rec1',gameId:'g',mode:'jev'});h.mediaRecord.mockResolvedValue({id:'media_foreign',recordingId:'other',kind:'screenshot'});h.findings.mockReturnValue([]);h.query.mockResolvedValue([{id:'rec1'}]);});
afterEach(()=>{delete process.env.WORKER_TOKEN});
it.each([
  {videoUrl:'/api/media/media_foreign'},
  {screenshotUrl:'/api/media/media_foreign'},
  {observations:[{at:0,type:'observation',text:'frame',screenshotUrl:'/api/media/media_foreign'}]},
])('rejects foreign media on a failed recording before writing %j',async(extra)=>{
  const response=await POST(request(extra)); expect(response.status).toBe(400); expect(h.mediaRecord).toHaveBeenCalledWith('ws1','media_foreign'); expect(h.query).not.toHaveBeenCalled(); expect(h.findings).not.toHaveBeenCalled();
});
it('accepts a failed run with owned evidence and persists scoped findings',async()=>{
 h.mediaRecord.mockResolvedValue({id:'media_owned',recordingId:'rec1',kind:'screenshot'});
 const response=await POST(request({screenshotUrl:'/api/media/media_owned',observations:[{at:0,type:'observation',text:'frame',screenshotUrl:'/api/media/media_owned'}]}));
 expect(response.status).toBe(200); expect(h.query).toHaveBeenCalledOnce();expect(h.findings).toHaveBeenCalledWith(expect.objectContaining({id:'rec1',status:'failed'}));
});

it.each([{videoUrl:'/api/media/media_owned'}, {screenshotUrl:'/api/media/media_owned'}])('rejects an owned asset of the wrong kind',async extra=>{
 h.mediaRecord.mockResolvedValue({id:'media_owned',recordingId:'rec1',kind:extra.videoUrl?'screenshot':'video'}); const response=await POST(request(extra));expect(response.status).toBe(400);expect(h.query).not.toHaveBeenCalled();
});
it('rejects a screenshot presented as a ready video, including for clips',async()=>{
 h.mediaRecord.mockResolvedValue({id:'media_owned',recordingId:'rec1',clipId:'clip1',kind:'screenshot'});
 expect((await POST(request({status:'ready',videoUrl:'/api/media/media_owned'}))).status).toBe(400);
 h.activeJob.mockResolvedValue({id:'clip1',kind:'clip',workspace_id:'ws1'}); h.get.mockResolvedValue({id:'clip1',recordingId:'rec1',gameId:'g'});
 expect((await POST(request({clipId:'clip1',status:'ready',videoUrl:'/api/media/media_owned'}))).status).toBe(400);
 expect(h.query).not.toHaveBeenCalled();
});
