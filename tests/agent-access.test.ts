import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { agentAnalytics, issueAgentToken, requireAgentWorkspace, revokeAgentToken } from '../src/lib/agent-access';
import { closeDatabase, put } from '../src/lib/db';
import { GET as report } from '../src/app/api/agent/report/route';
import type { Analytics } from '../src/lib/types';
beforeAll(() => { process.env.LOCAL_DATABASE_PATH='memory://'; });
afterAll(async () => { await closeDatabase(); });
describe('read-only agent access', () => {
 it('binds bearer tokens to stored workspaces and revokes immediately', async () => {
   const a = await issueAgentToken('workspace-a', 'Codex');
   const b = await issueAgentToken('workspace-b', 'Other');
   const request = (token:string) => new Request('https://blaze.example/api/agent/report?workspace=workspace-b', {headers:{Authorization:`Bearer ${token}`}});
   expect(await requireAgentWorkspace(request(a.token))).toBe('workspace-a');
   expect(await requireAgentWorkspace(request(b.token))).toBe('workspace-b');
   await expect(revokeAgentToken('workspace-b', a.id)).rejects.toMatchObject({status:404});
   expect(await requireAgentWorkspace(request(a.token))).toBe('workspace-a');
   await revokeAgentToken('workspace-a', a.id);
   await expect(requireAgentWorkspace(request(a.token))).rejects.toMatchObject({status:401});
 });
 it('expires tokens and rejects missing or malformed authorization', async () => {
   const a=await issueAgentToken('expiry', 'short-lived');
   await put('expiry', 'agent_token', {id:a.id,name:a.name,createdAt:a.createdAt,expiresAt:'2000-01-01T00:00:00.000Z'});
   await expect(requireAgentWorkspace(new Request('https://blaze.example',{headers:{authorization:`Bearer ${a.token}`}}))).rejects.toMatchObject({status:401});
   for(const authorization of ['', 'Bearer nope', 'Basic credentials']) await expect(requireAgentWorkspace(new Request('https://blaze.example',{headers:{authorization}}))).rejects.toMatchObject({status:401});
 });
 it('isolates report data across workspaces and validates report parameters', async () => {
   const a = await issueAgentToken('report-a', 'reader');
   await put('report-a','game',{id:'own',title:'Own',url:'https://example.com/own'});
   await put('report-b','game',{id:'other',title:'Other',url:'https://example.com/other'});
   const get = (query:string) => report(new Request(`https://blaze.example/api/agent/report?${query}`,{headers:{authorization:`Bearer ${a.token}`}}));
   const listed = await (await get('report=games')).json();
   expect(listed.games.map((g:{id:string}) => g.id)).toEqual(['own']);
   expect((await get('report=discovery&gameId=other')).status).toBe(404);
   expect((await get('report=discovery&gameId=../other')).status).toBe(400);
   expect((await get('report=analytics&gameId=own&days=999')).status).toBe(400);
   expect((await get('report=games&workspace=report-b')).status).toBe(400);
   expect((await get('report=games&report=discovery')).status).toBe(400);
   await put('report-a','citation_evidence',{id:'own',gameId:'own',source:'Owner-reported Bing AI Performance',page:'https://example.com/own',startDate:'2026-01-01',endDate:'2026-01-31',citations:3,importedAt:'2026-02-01T00:00:00.000Z'});
   const discovery = await get('report=discovery&gameId=own');
   expect(discovery.status).toBe(200);
   expect(await discovery.json()).toMatchObject({gameId:'own',review:null,citations:{citations:3,source:'Owner-reported Bing AI Performance'}});
 });
 it('does not leak raw session data or future analytics fields', () => {
   const result = agentAnalytics({ sessions:3, players:2, sessionsList:[{playerId:'private-player', id:'private-session'}], trend:[{date:'2026-01-01',visits:1,starts:1,completions:0,secret:'private-nested'}], credentials:'private-key', sources:[{name:'private-source'}], heatmap:[{screen:'private-screen'}] } as unknown as Analytics);
   expect(result.sessions).toBe(3);
   expect(JSON.stringify(result)).not.toContain('private-');
   expect(result).not.toHaveProperty('sessionsList');
 });
});
