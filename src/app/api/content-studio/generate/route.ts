import { reconcileContentBatch } from "@/lib/content-batch-recovery";
import { z } from "zod";
import { requireIdentity, apiError, HttpError } from "@/lib/auth";
import { sameOrigin } from "@/lib/security";
import { get, list, rateLimit } from "@/lib/db";
import { onDemandProposal, approveOnDemand, generateOnDemand, type OnDemandReceipt } from "@/lib/on-demand-content";
const schema=z.discriminatedUnion("action",[
 z.object({action:z.literal("start"),id:z.string().min(1).max(100)}).strict(),
 z.object({action:z.literal("proposal"),gameId:z.string().min(1).max(100),count:z.union([z.literal(2),z.literal(3)])}).strict(),
 z.object({action:z.literal("generate"),gameId:z.string().min(1).max(100),count:z.union([z.literal(2),z.literal(3)]),proposalHash:z.string().regex(/^[a-f0-9]{64}$/),requestId:z.string().uuid(),acknowledgeCost:z.literal(true)}).strict(),
]);
export const maxDuration=60;
export async function GET(request:Request){
 try{
  const user=await requireIdentity();const params=new URL(request.url).searchParams;const id=params.get("id");
  let receipt:OnDemandReceipt|undefined;
  if(id){z.string().min(1).max(100).parse(id);receipt=await get<OnDemandReceipt>(user.workspace_id,"on_demand_content",id);if(!receipt)throw new HttpError(404,"Content request not found.");}
  else{const gameId=z.string().min(1).max(100).parse(params.get("gameId"));receipt=(await list<OnDemandReceipt>(user.workspace_id,"on_demand_content")).filter(r=>r.gameId===gameId&&r.approvedBy===user.id).sort((a,b)=>b.approvedAt.localeCompare(a.approvedAt))[0];}
  if(receipt){await reconcileContentBatch(user.workspace_id,"on_demand_content",receipt.id);receipt=await get<OnDemandReceipt>(user.workspace_id,"on_demand_content",receipt.id);}
  return Response.json({result:receipt||null},{headers:{"Cache-Control":"private, no-store"}});
 }catch(error){return apiError(error);}
}
export async function POST(request:Request){
 try{
  if(!sameOrigin(request))throw new HttpError(403,"Use your workspace to generate content.");
  const user=await requireIdentity();if(!await rateLimit(`content-generate:${user.workspace_id}`,15))throw new HttpError(429,"Too many requests. Try again shortly.");
  const reader=request.body?.getReader();if(!reader)throw new HttpError(400,"Missing request.");let bytes=0;const chunks:Uint8Array[]=[];
  for(;;){const part=await reader.read();if(part.done)break;bytes+=part.value.byteLength;if(bytes>4096){await reader.cancel();throw new HttpError(413,"Request too large.");}chunks.push(part.value);}
  const body=schema.parse(JSON.parse(Buffer.concat(chunks,bytes).toString("utf8")));
  if(body.action==="start"){
    const receipt=await get<OnDemandReceipt>(user.workspace_id,"on_demand_content",body.id);
    if(!receipt||receipt.approvedBy!==user.id)throw new HttpError(404,"Content request not found.");
    return Response.json({result:await generateOnDemand(user.workspace_id,receipt.id)},{headers:{"Cache-Control":"private, no-store"}});
  }
  const proposal=body.action==="proposal"?await onDemandProposal(user.workspace_id,body.gameId,body.count):null;
  if(proposal)return Response.json({result:proposal},{headers:{"Cache-Control":"private, no-store"}});
  if(body.action!=="generate")throw new HttpError(400,"Unknown content action.");
  const receipt=await approveOnDemand(user.workspace_id,user.id,body);
  const result=receipt.state==="approved"?await generateOnDemand(user.workspace_id,receipt.id):receipt;
  return Response.json({result},{headers:{"Cache-Control":"private, no-store"}});
 }catch(error){if(error instanceof z.ZodError||error instanceof SyntaxError)return Response.json({error:"Check the game, count and cost consent."},{status:400});return apiError(error);}
}
