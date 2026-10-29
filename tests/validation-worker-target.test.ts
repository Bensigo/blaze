import { describe, expect, it } from 'vitest';
import { matchesValidationClaim, validationTarget } from '../worker/validation-target';
const id = `rec_${'a'.repeat(32)}`;
describe('single validation target', () => {
  it('accepts only an explicit generated recording ID', () => {
    expect(validationTarget(undefined)).toBeUndefined();
    expect(validationTarget(id)).toBe(id);
    for (const bad of ['', 'rec_foo', `rec_${'A'.repeat(32)}`, `${id}/other`, ` ${id}`]) expect(() => validationTarget(bad)).toThrow();
  });
  it('rejects any other recording or clip', () => {
    expect(matchesValidationClaim(id,{recording:{id}})).toBe(true);
    expect(matchesValidationClaim(id,{})).toBe(false);
    expect(matchesValidationClaim(id,{recording:{id:`rec_${'b'.repeat(32)}`}})).toBe(false);
    expect(matchesValidationClaim(id,{recording:{id},clip:{id:'clip'}})).toBe(false);
  });
});
