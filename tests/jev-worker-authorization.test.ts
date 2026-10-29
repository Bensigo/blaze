import {afterEach,describe,expect,it,vi} from 'vitest';
const claim=vi.hoisted(()=>vi.fn());
vi.mock('../src/lib/jobs',()=>({claimJob:claim}));
import {POST} from '../src/app/api/worker/claim/route';
afterEach(()=>{delete process.env.WORKER_TOKEN;claim.mockReset()});
describe('worker claim authorization',()=>{
  it('never calls claim or sends its secret without the worker bearer token',async()=>{
    process.env.WORKER_TOKEN='worker-token';claim.mockResolvedValue({jevKey:'mock-key'});
    const response=await POST(new Request('http://localhost/api/worker/claim',{method:'POST'}));
    expect(response.status).toBe(401);expect(await response.text()).not.toContain('mock-key');expect(claim).not.toHaveBeenCalled();
  });
  it('returns the claim only to an authorized worker without caching',async()=>{
    process.env.WORKER_TOKEN='worker-token';claim.mockResolvedValue({jevKey:'mock-key',jevModel:'typesafe/jev-1.13'});
    const response=await POST(new Request('http://localhost/api/worker/claim',{method:'POST',headers:{Authorization:'Bearer worker-token'}}));
    expect(response.status).toBe(200);expect(response.headers.get('cache-control')).toBe('no-store');expect(await response.json()).toEqual({jevKey:'mock-key',jevModel:'typesafe/jev-1.13'});
  });
});
