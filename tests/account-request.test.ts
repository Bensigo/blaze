import {beforeEach,describe,it,expect,vi} from 'vitest';
import {z} from 'zod';
const state=vi.hoisted(()=>({workspace:'ws-a',allowed:true,authenticated:true}));
vi.mock('../src/lib/auth',()=>({requireIdentity:async()=>{if(!state.authenticated)throw new Error('unauthorized');return {workspace_id:state.workspace};},apiError:()=>Response.json({error:'Sign in required.'},{status:401})}));
vi.mock('../src/lib/db',()=>({rateLimit:async()=>state.allowed}));
import {accountWrite} from '../src/lib/account-request';
import {AccountSettingsError} from '../src/lib/ai-settings';
const schema=z.object({provider:z.enum(['anthropic','openrouter']),token:z.string().min(8)}).strict();
const request=(data:unknown,origin='https://blaze.example')=>new Request('https://blaze.example/api/account/ai',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(data)});
beforeEach(()=>{state.workspace='ws-a';state.allowed=true;state.authenticated=true;});
describe('account settings API boundary',()=>{
 it('requires authentication, same origin and rate admission before updating',async()=>{
  const operation=vi.fn();
  expect((await accountWrite(request({provider:'openrouter',token:'controlled-key'},'https://other.example'),schema,operation)).status).toBe(403);
  state.authenticated=false;expect((await accountWrite(request({provider:'openrouter',token:'controlled-key'}),schema,operation)).status).toBe(401);
  state.authenticated=true;state.allowed=false;expect((await accountWrite(request({provider:'openrouter',token:'controlled-key'}),schema,operation)).status).toBe(429);
  expect(operation).not.toHaveBeenCalled();
 });
 it('scopes writes from identity and rejects client workspace and schema errors without values',async()=>{
  const operation=vi.fn().mockResolvedValue({ok:true});
  const rejected=await accountWrite(request({provider:'openrouter',token:'controlled-key',workspace:'ws-b'}),schema,operation);
  expect(rejected.status).toBe(400);expect(await rejected.text()).not.toContain('controlled-key');expect(operation).not.toHaveBeenCalled();
  expect((await accountWrite(request({provider:'openrouter',token:'controlled-key'}),schema,operation)).status).toBe(200);
  expect(operation).toHaveBeenCalledWith('ws-a',{provider:'openrouter',token:'controlled-key'});
 });
 it('only returns deliberate safe errors, never internal provider or secret messages',async()=>{
  const response=await accountWrite(request({provider:'openrouter',token:'controlled-key'}),schema,async()=>{throw new Error('controlled-key provider raw body');});
  expect(await response.text()).not.toContain('controlled-key');
  const safe=await accountWrite(request({provider:'openrouter',token:'controlled-key'}),schema,async()=>{throw new AccountSettingsError('Selected model is unavailable.');});
  expect(await safe.json()).toEqual({error:'Selected model is unavailable.'});expect(safe.headers.get('cache-control')).toBe('no-store');
 });
 it('rejects streamed over-limit bodies without trusting Content-Length',async()=>{
  const operation=vi.fn(); let cancelled=false;
  const stream=new ReadableStream<Uint8Array>({start(controller){controller.enqueue(new Uint8Array(10000));controller.enqueue(new Uint8Array(10000));},cancel(){cancelled=true;}});
  const req=new Request('https://blaze.example/api/account/ai',{method:'POST',headers:{Origin:'https://blaze.example','Content-Length':'1'},body:stream,duplex:'half'} as RequestInit);
  expect((await accountWrite(req,schema,operation)).status).toBe(413);
  expect(cancelled).toBe(true); expect(operation).not.toHaveBeenCalled();
 });

});
