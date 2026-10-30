import { GAMEPLAY_PRODUCER_SYSTEM } from "../src/lib/managed-gameplay-agent";
// Prints a NON-SECRET definition only. Does not call the API or create a resource.
console.log(JSON.stringify({
  name: "Blaze gameplay video producer", description: "Play a real game in the cloud, capture and edit one explicitly approved video.",
  model: { id: "claude-opus-5-5", effort: "low" }, system: GAMEPLAY_PRODUCER_SYSTEM,
  multiagent: { type: "multiagent_20261001", workflows: { type: "disabled" }, subagents: { type: "disabled" }, advisor: { type: "disabled" } },
  tools: [{ type: "agent_toolset_20260401", default_config: { enabled: false }, configs: ["bash", "read", "write", "edit", "glob", "grep"].map(name => ({ name, enabled: true })) }],
  metadata: { application: "blaze", purpose: "gameplay_video", schema: "1" },
}, null, 2));
