import {requireIdentity,apiError} from '@/lib/auth';
import {accountWrite} from '@/lib/account-request';
import {accountAIState,saveAISettings,settingsInput} from '@/lib/ai-settings';
export async function GET(){try {const user=await requireIdentity();return Response.json(await accountAIState(user.workspace_id),{headers:{'Cache-Control':'no-store'}});}catch(error){return apiError(error);}}
export async function POST(request:Request){return accountWrite(request,settingsInput,async(workspace,input)=>({settings:await saveAISettings(workspace,input)}));}
