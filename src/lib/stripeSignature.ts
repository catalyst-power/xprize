/**
 * Manual Stripe webhook signature verification (xprize#60).
 *
 * AgriFortress does not depend on the `stripe` SDK (kept minimal — the app
 * only ever needs the kernel's hosted checkout + this one webhook check).
 * Implements Stripe's documented `Stripe-Signature` scheme directly:
 * https://docs.stripe.com/webhooks#verify-manually
 *   header: "t=<timestamp>,v1=<hex hmac>[,v1=<hex hmac>...]"
 *   signed payload: `${timestamp}.${rawBody}`
 *   HMAC-SHA256 keyed by the endpoint's signing secret, hex-encoded.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

const DEFAULT_TOLERANCE_SECONDS = 300;

interface ParsedSignatureHeader {
  timestamp: string;
  signatures: string[];
}

function parseSignatureHeader(header: string): ParsedSignatureHeader | null {
  let timestamp: string | undefined;
  const signatures: string[] = [];

  for (const part of header.split(',')) {
    const [key, value] = part.split('=', 2);
    if (key === 't' && value !== undefined) timestamp = value;
    if (key === 'v1' && value !== undefined) signatures.push(value);
  }

  if (timestamp === undefined || signatures.length === 0) return null;
  return { timestamp, signatures };
}

/**
 * Verify a Stripe webhook signature against the raw request body.
 * `toleranceSeconds` guards against replay of an old, otherwise-valid payload.
 */
export function verifyStripeSignature(
  rawBody: string,
  signatureHeader: string | null,
  secret: string,
  toleranceSeconds: number = DEFAULT_TOLERANCE_SECONDS,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): boolean {
  if (!signatureHeader) return false;

  const parsed = parseSignatureHeader(signatureHeader);
  if (!parsed) return false;

  const timestampSeconds = Number.parseInt(parsed.timestamp, 10);
  if (!Number.isFinite(timestampSeconds)) return false;
  if (Math.abs(nowSeconds - timestampSeconds) > toleranceSeconds) return false;

  const expected = createHmac('sha256', secret)
    .update(`${parsed.timestamp}.${rawBody}`)
    .digest('hex');
  const expectedBuf = Buffer.from(expected, 'hex');

  return parsed.signatures.some((candidate) => {
    const candidateBuf = Buffer.from(candidate, 'hex');
    if (candidateBuf.length !== expectedBuf.length) return false;
    return timingSafeEqual(candidateBuf, expectedBuf);
  });
}
