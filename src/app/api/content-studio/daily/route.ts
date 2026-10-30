import {z} from "zod";
import {requireIdentity,apiError,HttpError} from "@/lib/auth";
import {sameOrigin} from "@/lib/security";
import {get,put,rateLimit} from "@/lib/db";
import {dailyContentProposal,approveDailyContent} from "@/lib/daily-content-consent";
import type {IdeaSchedule} from "@/lib/content-studio-contract";
const schema=z.discriminatedUnion("action",[z.object({action:z.literal("proposal")}).strict(),z.object({action:z.literal("approve"),proposalHash:z.string().regex(/^[a-f0-9]{64}$/),requestId:z.string().uuid(),acknowledgeCost:z.literal(true)}).strict(),z.object({action:z.literal("pause")}).strict()]);
export async function POST(request:Request){try{
 if(!sameOrigin(request))throw new HttpError(403,"Use this workspace to manage daily suggestions.");const user=await requireIdentity();if(!await rateLimit(`daily-content:${user.workspace_id}`,15))throw new HttpError(429,"Too many requests.");
 const reader=request.body?.getReader();if(!reader)throw new HttpError(400,"Missing request.");let size=0;const parts:Uint8Array[]=[];for(;;){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>4096){await reader.cancel();throw new HttpError(413,"Request too large.");}parts.push(part.value);}
 const body=schema.parse(JSON.parse(Buffer.concat(parts,size).toString("utf8")));let result:unknown;
 if(body.action==="proposal")result=await dailyContentProposal(user.workspace_id);
 if(body.action==="approve")result=await approveDailyContent(user.workspace_id,user.id,body);
 if(body.action==="pause"){const schedule=await get<IdeaSchedule>(user.workspace_id,"idea_schedule","default");if(schedule)result=await put(user.workspace_id,"idea_schedule",{...schedule,enabled:false});}
 return Response.json({result},{headers:{"Cache-Control":"private, no-store"}});
}catch(error){if(error instanceof z.ZodError||error instanceof SyntaxError)return Response.json({error:"Check the daily suggestion consent."},{status:400});return apiError(error);}}
