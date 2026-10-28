/** Trusted operator configuration, never derived from game input. */
export function internalNetwork(value: string | undefined) {
  const prefix = value === undefined ? "172.28.22" : value;
  const match = /^172\.(1[6-9]|2[0-9]|3[01])\.(0|[1-9][0-9]{0,2})$/.exec(prefix);
  if (!match || Number(match[2]) > 255) throw new Error("Invalid BLAZE_WORKER_NET_PREFIX");
  return { prefix, guard: `${prefix}.2`, browser: `${prefix}.3`, worker: `${prefix}.4` };
}
