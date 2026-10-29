import { requireIdentity,apiError,HttpError } from '@/lib/auth';
import { get } from '@/lib/db';
import { executionStatus } from '@/lib/execution-status';
export async function GET(request:Request){try{const user=await requireIdentity();const gameId=new URL(request.url).searchParams.get('gameId')||undefined;if(gameId&&(gameId.length>200||!await get(user.workspace_id,'game',gameId)))throw new HttpError(404,'Game not found.');return Response.json(await executionStatus(user.workspace_id,gameId),{headers:{'Cache-Control':'no-store'}});}catch(error){return apiError(error);}}
