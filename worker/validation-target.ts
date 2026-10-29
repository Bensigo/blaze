/** An explicitly configured validation worker accepts only one generated recording ID. */
export function validationTarget(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  if (!/^rec_[a-f0-9]{32}$/.test(value)) throw new Error('Invalid BLAZE_VALIDATION_RECORDING_ID');
  return value;
}
export function matchesValidationClaim(target: string, job: {recording?: {id?: unknown}; clip?: unknown}): boolean {
  return !job.clip && job.recording?.id === target;
}
