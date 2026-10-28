import { describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, writeFile, chmod } from "node:fs/promises";
import { resolve, join } from "node:path";
import { spawnSync } from "node:child_process";
import { privateStatePath, releaseOrigin, RELEASE_ORIGIN } from "./release-acceptance-utils";

describe("release acceptance safeguards", () => {
  it("only accepts the exact approved release origin", () => {
    expect(releaseOrigin(RELEASE_ORIGIN)).toBe(RELEASE_ORIGIN);
    for (const value of [undefined,"https://web-game-marketing.vercel.app.evil.test","http://web-game-marketing.vercel.app","https://web-game-marketing.vercel.app/"]) expect(() => releaseOrigin(value)).toThrow();
  });
  it("only loads private real authentication states from the ignored work folder", async () => {
    const work=resolve("work");await mkdir(work,{recursive:true});const dir=await mkdtemp(join(work,"state-guard-"));
    try {
      const secure=join(dir,"secure.json"), open=join(dir,"open.json");
      await writeFile(secure,"{}",{mode:0o600});await writeFile(open,"{}",{mode:0o644});await chmod(open,0o644);
      expect(await privateStatePath(secure,work)).toBe(secure);
      await expect(privateStatePath(open,work)).rejects.toThrow("private 0600");
      await expect(privateStatePath(resolve("package.json"),work)).rejects.toThrow("ignored work directory");
    } finally {await rm(dir,{recursive:true,force:true});}
  });
  it("rejects authenticated or fixture mode without explicit gates before network use", () => {
    const env={PATH:process.env.PATH || "",NODE_ENV:"test" as const,RELEASE_BASE_URL:RELEASE_ORIGIN,RELEASE_ACCEPTANCE_MODE:"fixture"};
    const first=spawnSync(process.execPath,["--import","tsx","tests/capture-deployed.ts"],{cwd:process.cwd(),env,encoding:"utf8"});
    expect(first.status).not.toBe(0);expect(first.stderr).toContain("ALLOW_LIVE_ACCEPTANCE=true");
    const second=spawnSync(process.execPath,["--import","tsx","tests/capture-deployed.ts"],{cwd:process.cwd(),env:{...env,ALLOW_LIVE_ACCEPTANCE:"true"},encoding:"utf8"});
    expect(second.status).not.toBe(0);expect(second.stderr).toContain("ALLOW_LIVE_FIXTURE_WRITES=true");
  },30000);
});
