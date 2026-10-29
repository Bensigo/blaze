import {accountWrite} from '@/lib/account-request';
import {jevInput,saveJevSettings} from '@/lib/ai-settings';
export async function POST(request:Request){return accountWrite(request,jevInput,saveJevSettings);}
