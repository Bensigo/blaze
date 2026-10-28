import {afterEach,describe,expect,it,vi} from 'vitest';
const context=vi.hoisted(()=>vi.fn());
vi.mock('@netlify/functions',()=>({getContext:context}));
import {canonicalRequestUrl} from '../src/lib/app-origin';
afterEach(()=>{vi.unstubAllEnvs();context.mockReset();});
function setup(){vi.stubEnv('NODE_ENV','production');vi.stubEnv('SITE_ID','blaze-site');vi.stubEnv('APP_URL','https://blaze.example');context.mockReturnValue({site:{id:'blaze-site',url:'https://blaze.example'}});}
describe('canonical request URL',()=>{
 it('preserves exact canonical requests without a platform exception',()=>{setup();const request=new Request('https://blaze.example/api/auth/callback/google?one=two');expect(canonicalRequestUrl(request)?.href).toBe(request.url);expect(context).not.toHaveBeenCalled();});
 it('normalizes a Netlify adapter origin only with trusted site identity and exact Host',()=>{setup();const request=new Request('http://internal.invalid:443/api/auth/callback/google?one=two',{headers:{Host:'blaze.example'}});expect(canonicalRequestUrl(request)?.href).toBe('https://blaze.example/api/auth/callback/google?one=two');});
 it.each(['wrong-site','wrong-host','wrong-site-url','no-context','local'])("rejects %s without trusting forwarded headers",mode=>{setup();const headers={Host:mode==='wrong-host'?'preview.blaze.example':'blaze.example','x-forwarded-host':'blaze.example','x-forwarded-proto':'https'};if(mode==='wrong-site')context.mockReturnValue({site:{id:'other',url:'https://blaze.example'}});if(mode==='wrong-site-url')context.mockReturnValue({site:{id:'blaze-site',url:'https://other.example'}});if(mode==='no-context')context.mockImplementation(()=>{throw Error('not a request');});if(mode==='local')vi.stubEnv('SITE_ID','');expect(canonicalRequestUrl(new Request('http://internal.invalid/api/auth/google',{headers}))).toBeNull();});
});
