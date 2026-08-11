import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import { verifyStripeSignature } from './stripeSignature';

const SECRET = 'whsec_test_secret';

function sign(rawBody: string, timestampSeconds: number, secret: string = SECRET): string {
  const signedPayload = `${timestampSeconds}.${rawBody}`;
  const signature = createHmac('sha256', secret).update(signedPayload).digest('hex');
  return `t=${timestampSeconds},v1=${signature}`;
}

describe('verifyStripeSignature', () => {
  it('accepts a correctly signed payload within the tolerance window', () => {
    const now = 1_700_000_000;
    const header = sign('{"id":"evt_1"}', now);
    expect(verifyStripeSignature('{"id":"evt_1"}', header, SECRET, 300, now)).toBe(true);
  });

  it('rejects when the signature does not match the body', () => {
    const now = 1_700_000_000;
    const header = sign('{"id":"evt_1"}', now);
    expect(verifyStripeSignature('{"id":"tampered"}', header, SECRET, 300, now)).toBe(false);
  });

  it('rejects when signed with the wrong secret', () => {
    const now = 1_700_000_000;
    const header = sign('{"id":"evt_1"}', now, 'wrong_secret');
    expect(verifyStripeSignature('{"id":"evt_1"}', header, SECRET, 300, now)).toBe(false);
  });

  it('rejects a timestamp outside the tolerance window (replay protection)', () => {
    const signedAt = 1_700_000_000;
    const header = sign('{"id":"evt_1"}', signedAt);
    const now = signedAt + 301;
    expect(verifyStripeSignature('{"id":"evt_1"}', header, SECRET, 300, now)).toBe(false);
  });

  it('rejects a missing signature header', () => {
    expect(verifyStripeSignature('{"id":"evt_1"}', null, SECRET)).toBe(false);
  });

  it('rejects a malformed signature header (no v1 component)', () => {
    expect(verifyStripeSignature('{"id":"evt_1"}', 't=1700000000', SECRET)).toBe(false);
  });
});
