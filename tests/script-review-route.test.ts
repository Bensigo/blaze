import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ approve: vi.fn(), start: vi.fn(), proposal: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireIdentity: async () => ({ workspace_id: "ws", id: "owner" }), HttpError: class extends Error { constructor(public status: number, message: string) { super(message); } }, apiError: (e: Error) => Response.json({ error: e.message }, { status: 409 }) }));
vi.mock("@/lib/security", () => ({ sameOrigin: () => true }));
vi.mock("@/lib/db", () => ({ rateLimit: async () => true }));
vi.mock("@/lib/content-scripts", () => ({ approveScriptReview: mocks.approve, startScriptReview: mocks.start, reviewScriptProposal: mocks.proposal, saveContentScript: vi.fn(), scriptState: vi.fn(), scriptReviewAvailability: vi.fn() }));
import { POST } from "../src/app/api/content-studio/scripts/route";

const input = { action: "request_review", scriptId: "script", reviewHash: "a".repeat(64), requestId: "c9a64698-300c-431b-8813-a5be4470f35b", maxCostCents: 1, acknowledgeCost: true };
const post = (body: unknown) => POST(new Request("http://localhost/api/content-studio/scripts", { method: "POST", body: JSON.stringify(body) }));

describe("review request route", () => {
  beforeEach(() => vi.resetAllMocks());
  it("requires explicit bounded consent before approving or starting", async () => {
    for (const body of [{ ...input, acknowledgeCost: false }, { ...input, maxCostCents: 2 }, { ...input, acknowledgeCost: undefined }]) expect((await post(body)).status).toBe(400);
    expect(mocks.approve).not.toHaveBeenCalled();
    expect(mocks.start).not.toHaveBeenCalled();
  });
  it("approves and starts the same grant, returning a consumed grant without another start", async () => {
    mocks.approve.mockResolvedValueOnce({ id: "review", state: "approved" }).mockResolvedValueOnce({ id: "review", state: "complete" });
    mocks.start.mockResolvedValue({ id: "review", state: "complete" });
    expect(await (await post(input)).json()).toEqual({ result: { id: "review", state: "complete" } });
    expect(await (await post(input)).json()).toEqual({ result: { id: "review", state: "complete" } });
    expect(mocks.approve).toHaveBeenCalledWith("ws", "owner", input);
    expect(mocks.start).toHaveBeenCalledOnce();
    expect(mocks.start).toHaveBeenCalledWith("ws", "review");
  });
  it("prepares a quote without approving or starting", async () => {
    mocks.proposal.mockResolvedValue({ script: { revision: "rev" }, reviewHash: input.reviewHash, binding: {}, inputBytes: 1, questionCount: 1, pricing: {}, costAdmission: {} });
    const response = await post({ action: "review_proposal", scriptId: "script" });
    expect(response.status).toBe(200);
    expect(mocks.approve).not.toHaveBeenCalled();
    expect(mocks.start).not.toHaveBeenCalled();
  });
});
