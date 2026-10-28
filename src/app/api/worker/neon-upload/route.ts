import { z } from 'zod';
import { bearer } from '@/lib/security';
import { activeJob } from '@/lib/jobs';
import { id, get, put, comparePut, remove } from '@/lib/db';
import { apiError, HttpError } from '@/lib/auth';
import { mediaContentType, registerMediaIfAbsent, type MediaRecord } from '@/lib/media';
import { neonStorageConfigured, neonUploadUrl, neonCopy, neonHead, neonRead } from '@/lib/neon-storage';
import type { Clip } from '@/lib/types';

const asset = z.object({ recordingId: z.string().min(1).max(100), clipId: z.string().min(1).max(100).optional(), kind: z.enum(['screenshot','video','clip']), size: z.number().int().positive().max(150 * 1024 * 1024) });
const input = z.discriminatedUnion('action', [asset.extend({action: z.literal('reserve')}), z.object({action:z.literal('finalize'), recordingId:z.string().min(1).max(100), clipId:z.string().min(1).max(100).optional(), intentId:z.string().regex(/^upload_[a-f0-9]{32}$/)})]);
type Intent = {id:string; recordingId:string; clipId?:string; kind:'screenshot'|'video'|'clip'; size:number; contentType:string; stagingKey:string; expiresAt:number; state:'issued'|'finalizing'|'complete'; leaseUntil?:number; mediaId?:string; record?:MediaRecord};
export async function POST(request: Request) {
  if (!bearer(request, 'WORKER_TOKEN')) return new Response(null,{status:401});
  try {
    if (!neonStorageConfigured()) throw new HttpError(503, 'Private Neon storage is not configured.');
    const data = input.parse(await request.json());
    const job = await activeJob(data.clipId || data.recordingId);
    if (data.clipId) {
      const clip = await get<Clip>(job.workspace_id, 'clip', data.clipId);
      if (job.kind !== 'clip' || !clip || clip.recordingId !== data.recordingId) throw new HttpError(400,'Asset does not match job.');
    } else if (job.kind !== 'recording') throw new HttpError(400,'Asset does not match job.');
    if (data.action === 'reserve') {
      if ((data.kind === 'clip') !== !!data.clipId) throw new HttpError(400,'Asset kind does not match job.');
      const intentId=id('upload'), stagingKey=`staging/${job.workspace_id}/${intentId}`;
      const contentType=data.kind==='screenshot'?'image/png':data.kind==='clip'?'video/mp4':'video/webm';
      const expiresAt=Date.now()+300000;
      const intent:Intent={id:intentId,recordingId:data.recordingId,clipId:data.clipId,kind:data.kind,size:data.size,contentType,stagingKey,expiresAt,state:'issued'};
      // This pointer exists before a capability can write an object; keep it until expiry and transfer grace.
      await put(job.workspace_id,'media_storage_intent',{id:`stage_${intentId}`,backend:'neon',location:stagingKey,cleanupUploadIntent:intentId,cleanupAfter:new Date(expiresAt+30*60000).toISOString()});
      await put(job.workspace_id,'neon_upload_intent',intent);
      return Response.json({intentId, uploadUrl:await neonUploadUrl(stagingKey,contentType),contentType},{headers:{'Cache-Control':'no-store'}});
    }
    const intent=await get<Intent>(job.workspace_id,'neon_upload_intent',data.intentId);
    if (!intent || intent.recordingId!==data.recordingId || intent.clipId!==data.clipId) throw new HttpError(400,'Upload authorization did not match.');
    if (intent.state==='complete' && intent.mediaId && intent.record) { const existing=await get<MediaRecord>(job.workspace_id,'media',intent.mediaId); if (existing?.deletedAt) throw new HttpError(410,'Asset is no longer available.'); if (!existing) { const pending=await get<{id:string}>(job.workspace_id,'media_storage_intent',intent.mediaId); if (!pending || !await registerMediaIfAbsent(job.workspace_id,intent.record)) throw new HttpError(410,'Asset is no longer available.'); } await remove(job.workspace_id,'media_storage_intent',intent.mediaId).catch(()=>{}); return Response.json({url:`/api/media/${intent.mediaId}`}); }
    if (intent.expiresAt+300000<Date.now()) throw new HttpError(400,'Upload authorization expired.');
    if (intent.state==='finalizing' && (intent.leaseUntil || 0)>Date.now()) throw new HttpError(409,'Upload is being finalized.');
    const claimed:Intent={...intent,state:'finalizing',leaseUntil:Date.now()+5*60000};
    if (!await comparePut(job.workspace_id,'neon_upload_intent',intent,claimed)) throw new HttpError(409,'Upload is being finalized.');
    const mid=id('media'), key=`media/${job.workspace_id}/${mid}`;
    // A fresh final key is never granted to the worker; retries get a new key and cleanup pointer.
    await put(job.workspace_id,'media_storage_intent',{id:mid,backend:'neon',location:key,uploadIntentId:intent.id,cleanupAfter:new Date(Date.now()+30*60000).toISOString()});
    await neonCopy(intent.stagingKey,key);
    const meta=await neonHead(key);
    if (meta.ContentLength!==intent.size || meta.ContentLength<1 || meta.ContentLength>150*1024*1024 || meta.ContentType!==intent.contentType) throw new HttpError(400,'Uploaded asset size or content type did not match.');
    const prefix=await neonRead(key,'bytes=0-15');
    const expectedPrefix=Math.min(16,intent.size);
    if (!prefix.Body || prefix.ContentLength!==expectedPrefix || prefix.ContentRange!==`bytes 0-${expectedPrefix-1}/${intent.size}`) throw new HttpError(400,'Invalid media range.');
    const parts:Buffer[]=[]; let length=0;
    for await (const chunk of prefix.Body as AsyncIterable<Uint8Array>) { length+=chunk.length; if(length>expectedPrefix) throw new HttpError(400,'Invalid media range.'); parts.push(Buffer.from(chunk)); }
    if (length!==expectedPrefix || mediaContentType(intent.kind,Buffer.concat(parts,length))!==intent.contentType) throw new HttpError(400,'Unsupported media data.');
    // The job may have expired while the object was copied.
    const currentJob=await activeJob(data.clipId || data.recordingId);
    if (currentJob.workspace_id!==job.workspace_id) throw new HttpError(409,'Worker job changed.');
    const record:MediaRecord={id:mid,recordingId:intent.recordingId,clipId:intent.clipId,kind:intent.kind,contentType:intent.contentType,size:intent.size,location:key,backend:'neon',createdAt:new Date().toISOString()};
    if (!await comparePut(job.workspace_id,'neon_upload_intent',claimed,{...claimed,state:'complete',mediaId:mid,record})) throw new HttpError(409,'Upload finalization lease expired.');
    if (!await registerMediaIfAbsent(job.workspace_id,record)) throw new HttpError(410,'Asset is no longer available.');
    await remove(job.workspace_id,'media_storage_intent',mid).catch(()=>{});
    return Response.json({url:`/api/media/${mid}`});
  } catch (e) { if (e instanceof z.ZodError) return Response.json({error:'Invalid upload request.'},{status:400}); return apiError(e); }
}
