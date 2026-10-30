import {z} from 'zod';
import {requireIdentity,apiError,HttpError} from '@/lib/auth';
import {sameOrigin} from '@/lib/security';
import {rateLimit} from '@/lib/db';
import {changeGameSource} from '@/lib/game-source';
export async function PATCH(request:Request,context:{params:Promise<{id:string}>}) {
  try {
    if(!sameOrigin(request))throw new HttpError(403,'Use this workspace to edit a source URL.');
    const user=await requireIdentity(); if(!await rateLimit(`game-source:${user.workspace_id}`,20))throw new HttpError(429,'Too many requests.');
    const reader=request.body?.getReader();if(!reader)throw new HttpError(400,'Missing request.');const chunks:Uint8Array[]=[];let size=0;for(;;){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>4096){await reader.cancel();throw new HttpError(413,'Request too large.');}chunks.push(part.value);}const text=Buffer.concat(chunks,size).toString('utf8');
    const body=z.object({url:z.string().min(1).max(2000),expectedRevision:z.string().min(1).max(100)}).strict().parse(JSON.parse(text));
    const {id}=await context.params;const game=await changeGameSource(user.workspace_id,z.string().max(100).parse(id),body.url,body.expectedRevision);
    return Response.json({game},{headers:{'Cache-Control':'private, no-store'}});
  }catch(error){if(error instanceof z.ZodError||error instanceof SyntaxError)return Response.json({error:'Check the source URL.'},{status:400});return apiError(error);}
}
