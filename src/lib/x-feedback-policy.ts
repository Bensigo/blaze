import { HttpError } from "./http-error";

// No runtime configuration can enable paid X verification yet. A provider-side
// total spending cap covering all charges and an explicit approval are required.
export const X_FEEDBACK_BUDGET_BLOCK = "X feedback is blocked: Blaze cannot enforce a provider-side total spending cap covering identity, search and possible extra charges. No paid verification is approved.";
export function requireXFeedbackBudget(): void { throw new HttpError(403, X_FEEDBACK_BUDGET_BLOCK); }
