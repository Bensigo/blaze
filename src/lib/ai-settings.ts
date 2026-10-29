import { z } from 'zod';
import { get, id, list, query } from './db';
import { encrypt, hash } from './security';
import { secretForConnection } from './credentials';
import { discoverAIModels, type AIProvider } from './ai-model-catalog';
import type { Connection, ProviderSecret } from './types';

export type AISettings = {id:'default';provider:AIProvider;model:string;connectionId:string;validatedAt:string;revision?:string;legacy?:boolean};
export const providerInput = z.enum(['anthropic','openrouter']);
const key = z.string().trim().min(8).max(4096).refine(value=>!/[\r\n]/.test(value),'Invalid API key.');
export const modelInput = z.object({provider:providerInput,connectionId:z.string().min(1).max(200).optional(),token:key.optional(),workspaceId:z.string().regex(/^[A-Za-z0-9_-]{1,200}$/).optional()}).strict();
export const settingsInput = modelInput.extend({model:z.string().regex(/^[~A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/)});
export const jevInput = z.object({connectionId:z.string().min(1).max(200).optional(),token:key.optional(),label:z.string().trim().min(1).max(100).optional(),model:z.enum(['typesafe/jev-1.13','typesafe/jev-1.14'])}).strict();
export class AccountSettingsError extends Error {}
const isAI = (value:string):value is AIProvider => value==='anthropic'||value==='openrouter';

async function fetchCatalog(provider:AIProvider, secret?:{token:string;workspaceId?:string}) {
  try {return await discoverAIModels(provider,secret);}catch {throw new AccountSettingsError('Unable to load model metadata. Check provider access and try again.');}
}

export async function readAISettings(workspace:string):Promise<AISettings|null> {
  const saved=await get<AISettings>(workspace,'ai_settings','default');
  if(saved) {
    if(!isAI(saved.provider)||!saved.model||!saved.connectionId)throw new AccountSettingsError('Saved AI settings are invalid. Review Account settings.');
    return saved;
  }
  // Preserve the former Anthropic-only setup explicitly; never pick between accounts.
  const legacy=(await list<Connection>(workspace,'connection')).filter(c=>c.provider==='anthropic'&&c.connected&&c.checkedAt&&c.model);
  return legacy.length===1 ? {id:'default',provider:'anthropic',model:legacy[0].model!,connectionId:legacy[0].id,validatedAt:legacy[0].checkedAt!,legacy:true} : null;
}


type Snapshot = { settings: AISettings; connection: Connection; encrypted: string };
async function selectionSnapshot(workspace: string): Promise<Snapshot> {
  const settings = await readAISettings(workspace);
  if (!settings) throw new AccountSettingsError('Choose an AI provider and model in Account settings.');
  const connection = await get<Connection>(workspace, 'connection', settings.connectionId);
  const encrypted = (await query<{encrypted:string}>('SELECT encrypted FROM credentials WHERE workspace_id=$1 AND provider=$2', [workspace, settings.connectionId]))[0]?.encrypted;
  if (!connection?.connected || connection.provider !== settings.provider || connection.model !== settings.model || !encrypted) throw new AccountSettingsError('The selected AI key or model changed. Review Account settings.');
  return { settings, connection, encrypted };
}
const sameSnapshot = (a: Snapshot, b: Snapshot) => JSON.stringify(a.settings) === JSON.stringify(b.settings) && JSON.stringify(a.connection) === JSON.stringify(b.connection) && a.encrypted === b.encrypted;
const selectionVersion = (snapshot: Snapshot) => snapshot.settings.revision || `legacy-${hash(JSON.stringify(snapshot.settings))}`;
const credentialVersion = (snapshot: Snapshot) => snapshot.connection.credentialVersion || `legacy-${hash(snapshot.encrypted)}`;
async function encryptedFor(workspace:string, connectionId?:string) {
  return connectionId ? (await query<{encrypted:string}>('SELECT encrypted FROM credentials WHERE workspace_id=$1 AND provider=$2',[workspace,connectionId]))[0]?.encrypted : undefined;
}
// All stale checks and writes occur in one statement. Existing rows are locked before
// the settings CAS; the settings row is the gate for the credential and connection writes.
async function saveSelection(workspace:string, kind:'ai_settings'|'jev_settings', priorSettings:unknown, priorConnection:Connection|undefined, priorEncrypted:string|undefined, connection:Connection, encrypted:string, settings:unknown) {
  const result=await query(`WITH locked_settings AS MATERIALIZED (SELECT body FROM records WHERE workspace_id=$1 AND kind=$3 AND id='default' FOR UPDATE),
    locked_connection AS MATERIALIZED (SELECT body FROM records WHERE workspace_id=$1 AND kind='connection' AND id=$2 FOR UPDATE),
    locked_key AS MATERIALIZED (SELECT encrypted FROM credentials WHERE workspace_id=$1 AND provider=$2 FOR UPDATE),
    candidate AS (SELECT 1 WHERE ($6::jsonb IS NULL AND NOT EXISTS(SELECT 1 FROM locked_connection) AND NOT EXISTS(SELECT 1 FROM locked_key)) OR
      ($6::jsonb IS NOT NULL AND EXISTS(SELECT 1 FROM locked_connection WHERE body=$6::jsonb) AND EXISTS(SELECT 1 FROM locked_key WHERE encrypted=$7))),
    saved_settings AS (INSERT INTO records(workspace_id,kind,id,body) SELECT $1,$3,'default',$4::jsonb FROM candidate
      WHERE ($5::jsonb IS NULL AND NOT EXISTS(SELECT 1 FROM locked_settings)) OR EXISTS(SELECT 1 FROM locked_settings WHERE body=$5::jsonb)
      ON CONFLICT(workspace_id,kind,id) DO UPDATE SET body=excluded.body,updated_at=now() WHERE $5::jsonb IS NOT NULL AND records.body=$5::jsonb RETURNING id),
    saved_key AS (INSERT INTO credentials(workspace_id,provider,encrypted) SELECT $1,$2,$8 FROM saved_settings ON CONFLICT(workspace_id,provider) DO UPDATE SET encrypted=excluded.encrypted RETURNING provider)
    INSERT INTO records(workspace_id,kind,id,body) SELECT $1,'connection',$2,$9::jsonb FROM saved_key ON CONFLICT(workspace_id,kind,id) DO UPDATE SET body=excluded.body,updated_at=now() RETURNING id`,
    [workspace,connection.id,kind,JSON.stringify(settings),priorSettings ? JSON.stringify(priorSettings) : null,priorConnection ? JSON.stringify(priorConnection) : null,priorEncrypted || null,encrypted,JSON.stringify(connection)]);
  if (!result.length) throw new AccountSettingsError('Settings changed while verifying. Reload Account settings and try again.');
}

export async function accountAIState(workspace:string) {
  const [settings,connections,jev]=await Promise.all([readAISettings(workspace),list<Connection>(workspace,'connection'),get<{id:string;connectionId:string;model?:string}>(workspace,'jev_settings','default')]);
  return {settings,credentials:connections.filter(c=>isAI(c.provider)&&c.connected).map(c=>({id:c.id,provider:c.provider,label:c.label,model:c.model,checkedAt:c.checkedAt})),jev:connections.filter(c=>c.provider==='openrouter'&&c.connected).map(c=>({id:c.id,label:c.label,checkedAt:c.checkedAt})),jevConnectionId:jev?.model ? jev.connectionId : undefined,jevModel:jev?.model};
}

async function inputSecret(workspace:string,input:z.infer<typeof modelInput>) {
  const connection=input.connectionId ? await get<Connection>(workspace,'connection',input.connectionId) : undefined;
  if(input.connectionId&&(!connection||connection.provider!==input.provider||!connection.connected))throw new AccountSettingsError('The selected provider key is unavailable in this workspace.');
  const stored=connection ? await secretForConnection(workspace,connection.id) : undefined;
  const token=input.token||stored?.token;
  if(!token)throw new AccountSettingsError('Enter an API key or select a saved key.');
  const secret:ProviderSecret={...stored,token,aiProvider:input.provider};
  if(input.workspaceId)secret.workspaceId=input.workspaceId;
  if(input.provider!=='anthropic')delete secret.workspaceId;
  return {connection,secret};
}
const catalogSecret=(secret:ProviderSecret)=>({token:secret.token,...(typeof secret.workspaceId==='string'?{workspaceId:secret.workspaceId}:{})});

export async function modelsForAccount(workspace:string,input:z.infer<typeof modelInput>) {
  if(input.provider==='openrouter'&&!input.connectionId&&!input.token)return fetchCatalog('openrouter');
  const {secret}=await inputSecret(workspace,input);
  return fetchCatalog(input.provider,catalogSecret(secret));
}

async function verifyOpenRouterKey(token:string) {
  try {
    const response=await fetch('https://openrouter.ai/api/v1/key',{headers:{Authorization:`Bearer ${token}`},redirect:'error',signal:AbortSignal.timeout(10000),cache:'no-store'});
    if(!response.ok)throw new AccountSettingsError();
    const reader=response.body?.getReader();
    if (!reader) throw new AccountSettingsError();
    const chunks:Uint8Array[]=[]; let size=0;
    for (;;) { const part=await reader.read(); if(part.done)break; size+=part.value.byteLength; if(size>65536){await reader.cancel();throw new AccountSettingsError();} chunks.push(part.value); }
    const bytes=new Uint8Array(size); let offset=0; for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
    const body=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
    if(!body||typeof body.data!=='object'||!body.data||Array.isArray(body.data))throw new AccountSettingsError();
  } catch {throw new AccountSettingsError('OpenRouter key verification failed. Check the key and account access.');}
}

export async function saveAISettings(workspace:string,input:z.infer<typeof settingsInput>) {
  const priorSettings=await get<AISettings>(workspace,'ai_settings','default');
  const beforeEncrypted=await encryptedFor(workspace,input.connectionId);
  const {connection:previous,secret}=await inputSecret(workspace,input);
  const priorEncrypted=await encryptedFor(workspace,previous?.id);
  if (beforeEncrypted !== priorEncrypted) throw new AccountSettingsError('Settings changed while verifying. Reload Account settings and try again.');
  const catalog=await fetchCatalog(input.provider,catalogSecret(secret));
  const model=catalog.models.find(m=>m.id===input.model);
  if(!model)throw new AccountSettingsError('The selected model is no longer available. Reload models and choose again.');
  if(!model.compatible)throw new AccountSettingsError('The selected model does not support the required text, tools and structured output capabilities.');
  if(input.provider==='openrouter')await verifyOpenRouterKey(secret.token);
  const stamp=new Date().toISOString(),connectionId=previous?.id||id('conn');
  const settings:AISettings={id:'default',provider:input.provider,model:input.model,connectionId,validatedAt:stamp,revision:id('rev')};
  const connection:Connection={...previous,credentialVersion:id('cred'),id:connectionId,provider:input.provider,label:previous?.label||`${input.provider==='openrouter'?'OpenRouter':'Anthropic'} workspace key`,connected:true,checkedAt:stamp,model:input.model,details:'Key and selected model metadata verified. Generation has not been tested.'};
  const encrypted=await encrypt({...secret,model:input.model,aiProvider:input.provider});
  await saveSelection(workspace,'ai_settings',priorSettings,previous,priorEncrypted,connection,encrypted,settings);
  return settings;
}

export async function resolveAISecret(workspace:string,verifyAvailability=true):Promise<ProviderSecret> {
  const initial = await selectionSnapshot(workspace);
  const secret=await secretForConnection(workspace,initial.settings.connectionId);
  if(!secret?.token||secret.model!==initial.settings.model)throw new AccountSettingsError('The selected AI key or model changed. Review Account settings.');
  const assertAISelection=async () => {
    try { if (!sameSnapshot(initial, await selectionSnapshot(workspace))) throw new Error(); }
    catch { throw new AccountSettingsError('The selected AI provider, model or key changed. Review Account settings.'); }
  };
  await assertAISelection();
  if(verifyAvailability) {
    const catalog=await fetchCatalog(initial.settings.provider,catalogSecret(secret));
    const model=catalog.models.find(m=>m.id===initial.settings.model);
    if(!model?.compatible)throw new AccountSettingsError('The selected AI model is unavailable or incompatible. Review Account settings.');
    await assertAISelection();
  }
  const result:ProviderSecret={...secret,model:initial.settings.model,aiProvider:initial.settings.provider,aiConnectionId:initial.settings.connectionId,aiSettingsRevision:selectionVersion(initial),aiCredentialVersion:credentialVersion(initial)};
  Object.defineProperty(result,'assertAISelection',{value:assertAISelection,enumerable:false});
  return result;
}

export type JevSettings = {id:'default';connectionId:string;model:string;revision:string;credentialVersion:string};
export async function verifyJevModel(model:string) {
  if (!['typesafe/jev-1.13','typesafe/jev-1.14'].includes(model)) throw new AccountSettingsError('Select a supported Jev decision model.');
  try {
    const response=await fetch(`https://openrouter.ai/api/v1/models/${model}/endpoints`,{redirect:'error',signal:AbortSignal.timeout(10000),cache:'no-store'});
    if (!response.ok) throw new Error();
    const reader=response.body?.getReader(); if(!reader) throw new Error();
    const chunks:Uint8Array[]=[]; let size=0;
    for (;;) { const part=await reader.read(); if(part.done)break; size+=part.value.byteLength; if(size>65536){await reader.cancel();throw new Error();} chunks.push(part.value); }
    const bytes=new Uint8Array(size); let offset=0; for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
    const schema=z.object({data:z.object({id:z.string(),architecture:z.object({input_modalities:z.array(z.string()),output_modalities:z.array(z.string())}),endpoints:z.array(z.object({status:z.number(),provider_name:z.string()}))})});
    const data=schema.parse(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes))).data;
    if (data.id!==model || !data.architecture.input_modalities.includes('text') || !data.architecture.output_modalities.includes('decisions') || !data.endpoints.some(e=>e.status===0&&e.provider_name==='TypeSafe')) throw new Error();
  } catch { throw new AccountSettingsError('The selected Jev decision model is unavailable. Review Account settings.'); }
}
export async function saveJevSettings(workspace:string,input:z.infer<typeof jevInput>) {
  const priorSettings=await get<JevSettings>(workspace,'jev_settings','default');
  const previous=input.connectionId?await get<Connection>(workspace,'connection',input.connectionId):undefined;
  if(input.connectionId&&(!previous||previous.provider!=='openrouter'||!previous.connected))throw new AccountSettingsError('The selected OpenRouter key is unavailable in this workspace.');
  if(previous && input.token) throw new AccountSettingsError('Choose a new key to enter a different OpenRouter key.');
  const priorEncrypted=await encryptedFor(workspace,previous?.id);
  const stored=previous?await secretForConnection(workspace,previous.id):undefined;
  const token=input.token||stored?.token;
  if(!token)throw new AccountSettingsError('Enter an OpenRouter key or select a saved key.');
  await Promise.all([verifyJevModel(input.model),verifyOpenRouterKey(token)]);
  const stamp=new Date().toISOString();
  const connection:Connection=previous || {id:id('conn'),provider:'openrouter',label:input.label||'OpenRouter gameplay key',connected:true,checkedAt:stamp,credentialVersion:id('cred'),details:'Key verified; gameplay has not been tested.'};
  const encrypted=previous ? priorEncrypted : await encrypt({token,aiProvider:'openrouter'});
  if(!encrypted)throw new AccountSettingsError('The selected OpenRouter key is unavailable in this workspace.');
  const version=`${connection.credentialVersion || 'legacy'}:${hash(encrypted)}`;
  const settings:JevSettings={id:'default',connectionId:connection.id,model:input.model,revision:id('rev'),credentialVersion:version};
  if(!previous) await saveSelection(workspace,'jev_settings',priorSettings,undefined,undefined,connection,encrypted,settings);
  else {
    const rows=await query(`WITH locked_settings AS MATERIALIZED (SELECT body FROM records WHERE workspace_id=$1 AND kind='jev_settings' AND id='default' FOR UPDATE), locked_connection AS MATERIALIZED (SELECT body FROM records WHERE workspace_id=$1 AND kind='connection' AND id=$2 FOR UPDATE), locked_key AS MATERIALIZED (SELECT encrypted FROM credentials WHERE workspace_id=$1 AND provider=$2 FOR UPDATE) INSERT INTO records(workspace_id,kind,id,body) SELECT $1,'jev_settings','default',$3::jsonb WHERE EXISTS(SELECT 1 FROM locked_connection WHERE body=$4::jsonb) AND EXISTS(SELECT 1 FROM locked_key WHERE encrypted=$5) AND (($6::jsonb IS NULL AND NOT EXISTS(SELECT 1 FROM locked_settings)) OR EXISTS(SELECT 1 FROM locked_settings WHERE body=$6::jsonb)) ON CONFLICT(workspace_id,kind,id) DO UPDATE SET body=excluded.body,updated_at=now() WHERE records.body=$6::jsonb RETURNING id`,[workspace,connection.id,JSON.stringify(settings),JSON.stringify(connection),encrypted,priorSettings?JSON.stringify(priorSettings):null]);
    if(!rows.length)throw new AccountSettingsError('Settings changed while verifying. Reload Account settings and try again.');
  }
  return {id:connection.id,label:connection.label,checkedAt:stamp,model:input.model};
}
