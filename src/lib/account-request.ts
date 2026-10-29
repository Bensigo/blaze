import {requireIdentity,apiError} from './auth';
import {sameOrigin} from './security';
import {rateLimit} from './db';
import {AccountSettingsError} from './ai-settings';
import {ZodError,type ZodType} from 'zod';
export async function accountWrite<T>(request:Request,schema:ZodType<T>,operation:(workspace:string,input:T,actor:string)=>Promise<unknown>) {
  try {
    if(!sameOrigin(request))return Response.json({error:'Invalid request origin.'},{status:403});
    const user=await requireIdentity();
    if(!await rateLimit(`account:${user.workspace_id}`,30,60))return Response.json({error:'Too many settings requests. Try again shortly.'},{status:429});
    if(Number(request.headers.get('content-length')||0)>16384)return Response.json({error:'Settings request is too large.'},{status:413});
    const reader=request.body?.getReader();
    if(!reader)return Response.json({error:'Invalid settings request.'},{status:400});
    const chunks:Uint8Array[]=[]; let size=0;
    for(;;){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>16384){await reader.cancel();return Response.json({error:'Settings request is too large.'},{status:413});}chunks.push(part.value);}
    const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
    let text:string;try{text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{return Response.json({error:'Invalid settings request.'},{status:400});}
    let input:T;
    try {input=schema.parse(JSON.parse(text));}catch(error){return Response.json({error:error instanceof ZodError?'Check the provider, key and model fields.':'Invalid settings request.'},{status:400});}
    try {return Response.json(await operation(user.workspace_id,input,user.id),{headers:{'Cache-Control':'no-store'}});}catch(error){return Response.json({error:error instanceof AccountSettingsError?error.message:'Unable to update account settings. Please try again.'},{status:400,headers:{'Cache-Control':'no-store'}});}
  } catch(error){return apiError(error);}
}
