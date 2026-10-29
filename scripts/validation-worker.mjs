#!/usr/bin/env node
// Inspect an existing stopped stack without printing its environment. No credentials are created.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const project = "blaze-controlled-33931ca";
const names = ["worker", "browser", "egress"].map((s) => `${project}-${s}-1`);
function command(cmd, args, options = {}) {
  const result = spawnSync(cmd, args, {
    cwd: root,
    encoding: "utf8",
    ...options,
  });
  if (result.error || result.status !== 0)
    throw new Error(`${cmd} inspection or operation failed`);
  return result.stdout;
}
function inspect() {
  const containers = JSON.parse(command("docker", ["inspect", ...names]));
  const byName = Object.fromEntries(
    containers.map((c) => [c.Name.slice(1), c]),
  );
  if (names.some((n) => !byName[n] || byName[n].State.Status !== "exited"))
    throw new Error("All three named containers must exist and be stopped.");
  const env = Object.fromEntries(
    (byName[names[0]].Config.Env || []).map((e) => {
      const i = e.indexOf("=");
      return [e.slice(0, i), e.slice(i + 1)];
    }),
  );
  const otherEnv = (name) =>
    Object.fromEntries(
      (byName[name].Config.Env || []).map((e) => {
        const i = e.indexOf("=");
        return [e.slice(0, i), e.slice(i + 1)];
      }),
    );
  let validUrl = false;
  try {
    const u = new URL(env.APP_URL);
    validUrl =
      u.origin === "https://blaze-bensigo.netlify.app" &&
      u.protocol === "https:" &&
      !u.username &&
      !u.password &&
      u.pathname === "/" &&
      !u.search &&
      !u.hash;
  } catch {}
  const token = !!env.WORKER_TOKEN;
  const egress =
    !!env.EGRESS_TOKEN &&
    env.EGRESS_TOKEN.length >= 32 &&
    names.slice(1).every((n) => otherEnv(n).EGRESS_TOKEN === env.EGRESS_TOKEN);
  const uploads =
    [env.NEON_CLIENT_UPLOAD, env.BLOB_CLIENT_UPLOAD].every(
      (v) => v === undefined || ["true", "false"].includes(v),
    ) &&
    !(env.NEON_CLIENT_UPLOAD === "true" && env.BLOB_CLIENT_UPLOAD === "true") &&
    (env.NEON_CLIENT_UPLOAD === "true" || env.BLOB_CLIENT_UPLOAD === "true");
  const images = names.map((n) => byName[n].Config.Image);
  console.log(
    `Stopped containers: present. APP_URL: ${validUrl ? "valid HTTPS origin" : "missing or invalid"}. Worker token: ${token ? "present" : "missing"}. Egress token: ${egress ? "present and consistent" : "missing or inconsistent"}. Private upload mode: ${uploads ? "configured" : "missing or invalid"}.`,
  );
  console.log(
    `Existing image names match: ${new Set(images).size === 1 ? "yes" : "no"}; current source and firewall compatibility are not established by inspection.`,
  );
  return { env, valid: validUrl && token && egress && uploads, images };
}
try {
  const [mode = "--check", target, ...extra] = process.argv.slice(2);
  if (
    !["--check", "--run"].includes(mode) ||
    extra.length ||
    (mode === "--check" && target) ||
    (mode === "--run" && !/^rec_[a-f0-9]{32}$/.test(target || ""))
  )
    throw new Error(
      "Usage: node scripts/validation-worker.mjs [--check | --run rec_<32 lowercase hex>]",
    );
  const { env, valid, images } = inspect();
  if (mode === "--check") process.exitCode = valid ? 0 : 1;
  else {
    if (!valid || new Set(images).size !== 1)
      throw new Error("Existing settings are incomplete or images differ.");
    const revision = command("git", ["rev-parse", "HEAD"]).trim();
    const dirty = command("git", ["status", "--porcelain"]);
    const chosenImage = process.env.BLAZE_VALIDATION_IMAGE || images[0];
    const image = JSON.parse(
      command("docker", ["image", "inspect", chosenImage]),
    )[0];
    if (
      dirty.trim() ||
      image.Config.Labels?.["org.opencontainers.image.revision"] !== revision
    )
      throw new Error(
        "Execution blocked: clean reviewed source and an existing image labelled with its exact revision are required; image identity is unverified.",
      );
    const childEnv = {
      ...process.env,
      APP_URL: env.APP_URL,
      WORKER_TOKEN: env.WORKER_TOKEN,
      EGRESS_TOKEN: env.EGRESS_TOKEN,
      NEON_CLIENT_UPLOAD: env.NEON_CLIENT_UPLOAD || "false",
      BLOB_CLIENT_UPLOAD: env.BLOB_CLIENT_UPLOAD || "false",
      BLAZE_WORKER_NET_PREFIX: env.BLAZE_WORKER_NET_PREFIX || "172.28.22",
      BLAZE_VALIDATION_RECORDING_ID: target,
      BLAZE_VALIDATION_IMAGE: chosenImage,
    };
    const base = [
      "compose",
      "-p",
      project,
      "-f",
      "compose.worker.yml",
      "-f",
      "compose.validation.yml",
    ];
    try {
      command(
        "docker",
        [
          ...base,
          "up",
          "--no-build",
          "--abort-on-container-exit",
          "--exit-code-from",
          "worker",
        ],
        { env: childEnv, stdio: "inherit" },
      );
    } finally {
      spawnSync("docker", [...base, "stop", "browser", "egress"], {
        cwd: root,
        env: childEnv,
        stdio: "inherit",
      });
    }
  }
} catch (error) {
  console.error(
    error instanceof Error ? error.message : "Validation launcher failed.",
  );
  process.exitCode = 1;
}
