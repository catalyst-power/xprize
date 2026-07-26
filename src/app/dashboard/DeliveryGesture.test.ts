import { describe, it, expect } from 'vitest';
import { getReceiptUrl } from './DeliveryGesture';

// ---------------------------------------------------------------------------
// getReceiptUrl
//
// Pure helper that maps a confirm response's externalId (the supply.received
// correlationId) to the dashboard receipt URL, or null when no lot id is
// present. Determines whether the gesture navigates to the receipt or falls
// back to the inline attestationId panel.
// ---------------------------------------------------------------------------

describe('getReceiptUrl', () => {
  it('returns the dashboard receipt URL when externalId is present', () => {
    const url = getReceiptUrl('lot_abc123');
    expect(url).toBe('/dashboard?lot=lot_abc123');
  });

  it('URL-encodes the externalId in the query string', () => {
    const url = getReceiptUrl('lot/with slashes');
    expect(url).toBe('/dashboard?lot=lot%2Fwith%20slashes');
  });

  it('returns null when externalId is undefined (fallback to inline attestationId panel)', () => {
    expect(getReceiptUrl(undefined)).toBeNull();
  });

  it('returns null when externalId is an empty string (kernel returned no lot id)', () => {
    expect(getReceiptUrl('')).toBeNull();
  });
});
