import {accountWrite} from '@/lib/account-request';
import {modelInput,modelsForAccount} from '@/lib/ai-settings';
export async function POST(request:Request){return accountWrite(request,modelInput,modelsForAccount);}
