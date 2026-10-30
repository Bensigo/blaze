import { afterEach, describe, expect, it, vi } from "vitest";
import { managedFileBytes, managedOutputFiles, startManagedSession } from "../src/lib/managed-gameplay-agent";
afterEach(() => vi.unstubAllGlobals());
describe("Managed Agent boundary", () => {
  it("uses the pinned agent, exact list-cost threshold and one initial task", async () => {
    const fetch = vi.fn(async () => Response.json({ id: "sesn_test", status: "running" })); vi.stubGlobal("fetch", fetch);
    await startManagedSession({ token: "test", workspaceId: "wrkspc_test" }, { agentId: "agent_test", agentVersion: 2, environmentId: "env_test", budgetCents: 125, prompt: "approved game task" });
    expect(fetch).toHaveBeenCalledOnce();
    const args = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(args[0]).toBe("https://api.anthropic.com/v1/sessions");
    expect(JSON.parse(String(args[1].body))).toMatchObject({ agent: { id: "agent_test", version: 2 }, budget: { max_list_cost: { amount: "125", currency: "USD" } }, initial_events: [{ type: "user.message" }] });
    expect(args[1].redirect).toBe("error");
  });
  it("rejects excess output size and paginated file lists instead of trusting an arbitrary URL", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new Uint8Array(11), { headers: { "content-length": "11" } })));
    await expect(managedFileBytes({ token: "test" }, "file_test", 10)).rejects.toThrow("too large");
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ data: [], next_page: "page_more" })));
    await expect(managedOutputFiles({ token: "test" }, "sesn_test")).rejects.toThrow("Too many");
  });
});
