import { z } from "zod";
import { accountWrite } from "@/lib/account-request";
import {
  publicBudgetCheck,
  publicValidationApproval,
  approvalInput,
  approveJevValidation,
  revokeJevValidation,
  verifyJevBudget,
} from "@/lib/jev-budget";
const input = z.discriminatedUnion("operation", [
  z.object({ operation: z.literal("verify") }).strict(),
  approvalInput,
  z.object({ operation: z.literal("revoke") }).strict(),
]);
export async function POST(request: Request) {
  return accountWrite(request, input, async (workspace, body, actor) => {
    if (body.operation === "verify")
      return { check: publicBudgetCheck(await verifyJevBudget(workspace)) };
    if (body.operation === "revoke") return revokeJevValidation(workspace);
    return {
      approval: publicValidationApproval(
        await approveJevValidation(workspace, actor, body),
      ),
    };
  });
}
