import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
const browser = vi.hoisted(() => ({ jar:new Map<string,string>(), writes:[] as {name:string;value:string;options:Record<string,unknown>}[] }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get:(name:string) => browser.jar.has(name) ? {name,value:browser.jar.get(name)} : undefined,
    getAll:() => [...browser.jar].map(([name,value]) => ({name,value})),
    set:(name:string,value:string,options:Record<string,unknown> = {}) => { browser.writes.push({name,value,options}); if(options.maxAge === 0) browser.jar.delete(name); else browser.jar.set(name,value); },
    delete:(name:string) => browser.jar.delete(name),
  }),
  headers: async () => new Headers({cookie:[...browser.jar].map(([k,v]) => `${k}=${v}`).join("; "),origin:"http://localhost:3000"}),
}));
import * as db from "../src/lib/db";
import * as auth from "../src/lib/auth";
import { GET as start } from "../src/app/api/auth/google/route";
import { GET as callback } from "../src/app/api/auth/callback/google/route";
import { POST as logout } from "../src/app/api/auth/logout/route";

const origin="http://localhost:3000", base="https://auth.example.test/neondb/auth";
const challengeName="__Secure-neon-auth.session_challenge", sessionName="__Secure-neon-auth.session_token";
const verifiedUser={ id:"provider-id", email:"person@example.test", name:"Person", emailVerified:true, workspace_id:"attacker-workspace", role:"admin" };
let calls: {url:string;body:string;headers:Headers}[] = [], verified=true, online=true;
let upstreamTarget="https://accounts.google.com/o/oauth2/v2/auth?state=provider-state", upstreamChallenge=true;
function fetchFake(input:string | URL | Request, init?:RequestInit) {
  const url=String(input instanceof Request ? input.url : input), headers=new Headers(init?.headers);
  calls.push({url,body:String(init?.body || ""),headers});
  if(!online) return Promise.reject(new Error("offline"));
  if(url===`${base}/sign-in/social`) {
    return Promise.resolve(Response.json({url:upstreamTarget,redirect:true},{headers:upstreamChallenge ? {"Set-Cookie":`${challengeName}=challenge-secret; Path=/; HttpOnly; Secure; SameSite=Lax`} : {}}));
  }
  if(url.startsWith(`${base}/get-session`)) {
    const u=new URL(url), cookie=headers.get("cookie") || "";
    if(u.searchParams.has("neon_auth_session_verifier")) {
      if(u.searchParams.get("neon_auth_session_verifier")!=="verifier" || !cookie.includes(`${challengeName}=challenge-secret`)) return Promise.resolve(Response.json({error:"invalid"},{status:401}));
      return Promise.resolve(Response.json({session:{id:"session",userId:"provider-id",expiresAt:new Date(Date.now()+3600000).toISOString()},user:verifiedUser},{headers:{"Set-Cookie":`${sessionName}=valid-session; Path=/; HttpOnly; Secure; SameSite=Lax`}}));
    }
    if(!verified || !cookie.includes(`${sessionName}=valid-session`)) return Promise.resolve(Response.json(null));
    return Promise.resolve(Response.json({session:{id:"session",userId:"provider-id",expiresAt:new Date(Date.now()+3600000).toISOString()},user:verifiedUser}));
  }
  if(url===`${base}/sign-out`) return Promise.resolve(Response.json({success:true}));
  throw new Error(`unexpected upstream request ${url}`);
}
function applyCookies(response:Response) {
  for(const cookie of response.headers.getSetCookie()) {
    const pair=cookie.split(";")[0], index=pair.indexOf("="); if(index>=0) browser.jar.set(pair.slice(0,index),pair.slice(index+1));
  }
}
function callbackRequest(params="neon_auth_session_verifier=verifier") {return new Request(`${origin}/api/auth/callback/google?${params}`,{headers:{cookie:[...browser.jar].map(([k,v])=>`${k}=${v}`).join("; ")}});}
beforeAll(()=>{process.env.LOCAL_DATABASE_PATH="memory://";delete process.env.DATABASE_URL;delete process.env.VERCEL;});
beforeEach(async()=>{
  browser.jar.clear();browser.writes.length=0;calls=[];verified=true;online=true;
  upstreamTarget="https://accounts.google.com/o/oauth2/v2/auth?state=provider-state";upstreamChallenge=true;
  vi.stubEnv("APP_URL",origin);vi.stubEnv("NEON_AUTH_BASE_URL",base);vi.stubEnv("NEON_AUTH_COOKIE_SECRET","test-cookie-secret-32-characters-long");vi.stubEnv("NEON_AUTH_GOOGLE_CONFIGURED","true");
  vi.stubGlobal("fetch",vi.fn(fetchFake));await db.query("DELETE FROM auth_sessions");await db.query("DELETE FROM users");
});
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();});
afterAll(async()=>{await db.closeDatabase();});

describe("Neon Managed Better Auth",()=>{
  it("uses SDK challenge and verifier exchange, checks upstream sessions, and keeps workspace ownership server-side",async()=>{
    const response=await start(new Request(`${origin}/api/auth/google`));
    expect(response.status).toBe(303);expect(new URL(response.headers.get("location")!).hostname).toBe("accounts.google.com");
    const signIn=calls.find(c=>c.url.endsWith("/sign-in/social"))!;
    expect(JSON.parse(signIn.body)).toMatchObject({provider:"google",callbackURL:`${origin}/api/auth/callback/google`});
    expect(response.headers.getSetCookie().some(c=>c.startsWith(`${challengeName}=`) && /httponly/i.test(c) && /secure/i.test(c))).toBe(true);
    applyCookies(response);
    const result=await callback(callbackRequest());
    expect(result.status).toBe(303);expect(result.headers.get("location")).toBe(`${origin}/app`);
    expect(result.headers.get("location")).not.toContain("verifier");applyCookies(result);
    const [a,b]=await Promise.all([auth.identity(),auth.identity()]);
    expect(a).toMatchObject({id:"neon:provider-id",email:verifiedUser.email,name:"Person"});
    expect(a?.workspace_id).not.toBe("attacker-workspace");expect(b?.workspace_id).toBe(a?.workspace_id);
    expect(calls.some(c=>c.url.includes("disableCookieCache=true"))).toBe(true);
    verified=false;expect(await auth.identity()).toBeNull();
  });
  it("redirects the browser to the exact Neon initialization URL with its challenge cookie",async()=>{
    upstreamTarget=`${base}/sign-in/social/init?token=one-time-test-token`;
    const response=await start(new Request(`${origin}/api/auth/google`));
    expect(response.status).toBe(303); expect(response.headers.get("location")).toBe(upstreamTarget);
    expect(response.headers.get("cache-control")).toContain("no-store"); expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.getSetCookie().some(c=>c.startsWith(`${challengeName}=`) && /httponly/i.test(c) && /secure/i.test(c))).toBe(true);
    expect(calls.map(c=>c.url)).toEqual([`${base}/sign-in/social`]);
    upstreamChallenge=false;
    const missing=await start(new Request(`${origin}/api/auth/google`));
    expect(missing.headers.get("location")).toBe(`${origin}/app?auth=setup`);
    expect(JSON.stringify([...missing.headers])).not.toContain("one-time-test-token");
  });
  it("rejects altered Neon init URLs and never reflects their tokens",async()=>{
    const privateToken="private-init-test-token";
    const invalid=[
      `https://other.example.test/neondb/auth/sign-in/social/init?token=${privateToken}`,
      `https://auth.example.test/other/auth/sign-in/social/init?token=${privateToken}`,
      `${base}/sign-in/social/init?token=${privateToken}&next=https%3A%2F%2Fevil.test`,
      `${base}/sign-in/social/init?token=${privateToken}&token=second`,
      `${base}/sign-in/social/init`, `${base}/sign-in/social/init?token=`,
      `${base}/sign-in/social/init?token=%20`,
      `${base}/sign-in/social/init?token=${privateToken}#fragment`,
      `https://user:pass@auth.example.test/neondb/auth/sign-in/social/init?token=${privateToken}`,
      `http://auth.example.test/neondb/auth/sign-in/social/init?token=${privateToken}`,
      `${base}/sign-in/social/init?token=${"x".repeat(4097)}`,
      `https://user:pass@accounts.google.com/o/oauth2/v2/auth?state=${privateToken}`,
    ];
    for (const target of invalid) {
      upstreamTarget=target;
      const response=await start(new Request(`${origin}/api/auth/google`));
      expect(response.status).toBe(303); expect(response.headers.get("location")).toBe(`${origin}/app?auth=setup`);
      expect(response.headers.getSetCookie()).toEqual([]);
      expect(JSON.stringify([...response.headers])).not.toContain(privateToken);
      expect(await response.text()).not.toContain(privateToken);
    }
  });
  it("rejects absent challenge, invalid verifier, cross-origin callback, and never reflects secrets",async()=>{
    const absent=await callback(callbackRequest());expect(absent.headers.get("location")).toBe(`${origin}/app?auth=failed`);
    const signIn=await start(new Request(`${origin}/api/auth/google`));applyCookies(signIn);
    const bad=await callback(callbackRequest("neon_auth_session_verifier=bad-private-token"));
    expect(bad.headers.get("location")).toBe(`${origin}/app?auth=failed`);
    const foreign=await callback(new Request("https://evil.test/api/auth/callback/google?neon_auth_session_verifier=private"));
    expect(foreign.headers.get("location")).toBe(`${origin}/app?auth=failed`);
    expect(JSON.stringify([...bad.headers])).not.toContain("bad-private-token");
  });
  it("fails closed without verified provider session or owner Google setup and prohibits production local login",async()=>{
    vi.stubEnv("NODE_ENV","production");vi.stubEnv("APP_URL","https://app.example.test");
    vi.stubEnv("NEON_AUTH_GOOGLE_CONFIGURED","");
    expect((await start(new Request("https://app.example.test/api/auth/google"))).headers.get("location")).toBe("https://app.example.test/app?auth=setup");
    browser.jar.set(sessionName,"valid-session"); expect(await auth.identity()).toBeNull();
    expect(calls.some(c=>c.url.includes("/get-session"))).toBe(false);
    await expect(auth.createSession({id:"local",email:"test@example.test",name:"Local"})).rejects.toThrow();
  });
  it("requires same origin for logout and clears session and challenge cookies even if upstream fails",async()=>{
    browser.jar.set(sessionName,"valid-session");browser.jar.set(challengeName,"challenge-secret");browser.jar.set("unrelated","keep");online=false;
    const bad=await logout(new Request(`${origin}/api/auth/logout`,{method:"POST",headers:{origin:"https://evil.test"}}));expect(bad.status).toBe(403);expect(browser.jar.has(sessionName)).toBe(true);
    const ok=await logout(new Request(`${origin}/api/auth/logout`,{method:"POST",headers:{origin}}));expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ok:true,revoked:false});
    expect(browser.jar.has(sessionName)).toBe(false);expect(browser.jar.has(challengeName)).toBe(false);expect(browser.jar.get("unrelated")).toBe("keep");
  });
});
