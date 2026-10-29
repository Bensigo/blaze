import {afterEach, describe, expect, it, vi} from 'vitest';
import {choose} from '../worker/jev-decision';
const actions=[{id:'left',label:'Move left'},{id:'right',label:'Move right'}];
afterEach(()=>vi.unstubAllGlobals());
describe('Jev decision transport',()=>{
  it('sends the pinned decision model and state to OpenRouter System One',async()=>{
    const fetcher=vi.fn().mockResolvedValue(new Response(JSON.stringify({model:'typesafe/jev-1.13-20260917',answers:{next:{type:'choice',choice:'left'}}})));
    vi.stubGlobal('fetch',fetcher);
    expect(await choose({turn:1},actions,'mock-key','typesafe/jev-1.13')).toBe('left');
    const [url,init]=fetcher.mock.calls[0];
    expect(url).toBe('https://openrouter.ai/api/v1/systemone');
    expect(init.headers.Authorization).toBe('Bearer mock-key'); expect(init.redirect).toBe('error'); expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.parse(init.body)).toEqual({model:'typesafe/jev-1.13',state:{turn:1},questions:{next:{type:'choice',instructions:'Choose the next gameplay action from the allowed options.',criteria:{left:'Move left',right:'Move right'}}}});
  });
  it.each([{type:'choice',choice:'unknown'},{type:'noul',choice:'left'},{type:'choice',choice:3}])('rejects invalid choices %j',async answer=>{
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(JSON.stringify({model:'typesafe/jev-1.13-20260917',answers:{next:answer}}))));
    await expect(choose({},actions,'mock-key','typesafe/jev-1.13')).rejects.toThrow('invalid action');
  });
  it.each([undefined,'typesafe/jev-1.14-20261001','typesafe/jev-router','typesafe/jev-1.13-extra'])('rejects unexpected resolved model %s',async resolved=>{
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(JSON.stringify({model:resolved,answers:{next:{type:'choice',choice:'left'}}}))));
    await expect(choose({},actions,'mock-key','typesafe/jev-1.13')).rejects.toThrow('invalid action');
  });
  it('bounds responses and sanitizes provider and timeout errors',async()=>{
    for (const result of [new Response('x'.repeat(65537)),new Response('mock-key leaked',{status:401})]) {
      vi.stubGlobal('fetch',vi.fn().mockResolvedValue(result));
      await expect(choose({},actions,'mock-key','typesafe/jev-1.13')).rejects.toThrow('Jev decision failed or returned an invalid action');
    }
    vi.stubGlobal('fetch',vi.fn().mockRejectedValue(new Error('mock-key timeout')));
    await expect(choose({},actions,'mock-key','typesafe/jev-1.13')).rejects.toThrow('Jev decision failed or returned an invalid action');
  });
  it('rejects unknown models and malformed action IDs before calling provider',async()=>{
    const fetcher=vi.fn(); vi.stubGlobal('fetch',fetcher);
    await expect(choose({},actions,'mock-key','typesafe/jev-router')).rejects.toThrow('Invalid Jev decision request');
    await expect(choose({},[{id:'bad id',label:'bad'},actions[0]],'mock-key','typesafe/jev-1.13')).rejects.toThrow('Invalid Jev decision request');
    expect(fetcher).not.toHaveBeenCalled();
  });
});
