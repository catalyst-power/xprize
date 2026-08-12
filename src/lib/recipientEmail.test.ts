import { describe, it, expect } from 'vitest';
import { isValidRecipientEmail } from './recipientEmail';

describe('isValidRecipientEmail', () => {
  it('accepts a plain email address', () => {
    expect(isValidRecipientEmail('david@graceharbour.farm')).toBe(true);
  });

  it('accepts an address with a plus tag and subdomain', () => {
    expect(isValidRecipientEmail('david+delivery@mail.graceharbour.farm')).toBe(true);
  });

  it('trims surrounding whitespace before validating', () => {
    expect(isValidRecipientEmail('  david@graceharbour.farm  ')).toBe(true);
  });

  it('returns false for undefined', () => {
    expect(isValidRecipientEmail(undefined)).toBe(false);
  });

  it('returns false for an empty string', () => {
    expect(isValidRecipientEmail('')).toBe(false);
  });

  it('returns false for whitespace only', () => {
    expect(isValidRecipientEmail('   ')).toBe(false);
  });

  it('returns false when there is no @', () => {
    expect(isValidRecipientEmail('david.graceharbour.farm')).toBe(false);
  });

  it('returns false when there is no domain dot', () => {
    expect(isValidRecipientEmail('david@graceharbour')).toBe(false);
  });

  it('returns false when there is whitespace inside the address', () => {
    expect(isValidRecipientEmail('david @graceharbour.farm')).toBe(false);
  });

  it('returns false for a bare name (no email shape at all)', () => {
    expect(isValidRecipientEmail('David Ko')).toBe(false);
  });
});
