import { describe, it, expect } from 'vitest';
import { getReceiptUrl, resolveDeliveryFields, resolveCaptureOutcome } from './DeliveryGesture';
import type { RecentLot } from '@/lib/supply';

// ---------------------------------------------------------------------------
// resolveDeliveryFields
//
// Pure helper that merges Gemini inference metadata with the supplier's most
// recent lot (a fallback prior). Inference wins when present; priorLot.commodity
// seeds the product field only when inference returned nothing.
// ---------------------------------------------------------------------------

const RECENT_LOT: RecentLot = {
  correlationId: 'lot_abc123',
  originatingDid: 'did:imajin:scott',
  commodity: 'eggs',
  status: 'received',
  createdAt: '2026-01-01T00:00:00Z',
};

describe('resolveDeliveryFields', () => {
  it('uses inference product when present (inference wins over prior)', () => {
    const fields = resolveDeliveryFields({ product: 'apples' }, RECENT_LOT);
    expect(fields.product).toBe('apples');
  });

  it('falls back to priorLot.commodity when inference returned no product', () => {
    const fields = resolveDeliveryFields({}, RECENT_LOT);
    expect(fields.product).toBe('eggs');
  });

  it('returns empty string for product when priorLot.commodity is null', () => {
    const lotNullCommodity: RecentLot = { ...RECENT_LOT, commodity: null };
    const fields = resolveDeliveryFields({}, lotNullCommodity);
    expect(fields.product).toBe('');
  });

  it('returns empty string for product when no inference and no priorLot', () => {
    const fields = resolveDeliveryFields({}, undefined);
    expect(fields.product).toBe('');
  });

  it('converts numeric qty from inference to a string', () => {
    const fields = resolveDeliveryFields({ qty: 6 }, undefined);
    expect(fields.qty).toBe('6');
  });

  it('leaves qty blank when inference returned no qty', () => {
    const fields = resolveDeliveryFields({}, RECENT_LOT);
    expect(fields.qty).toBe('');
  });

  it('maps unit, recipient, lot, and notes from inference metadata', () => {
    const fields = resolveDeliveryFields(
      { unit: 'dozen', recipient: 'Grace Harbour', lot: 'L1', notes: 'fresh' },
      undefined,
    );
    expect(fields.unit).toBe('dozen');
    expect(fields.recipient).toBe('Grace Harbour');
    expect(fields.lot).toBe('L1');
    expect(fields.notes).toBe('fresh');
  });
});

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

// ---------------------------------------------------------------------------
// resolveCaptureOutcome (xprize#48)
//
// The kernel returns HTTP 200 even for a pipeline-level failure (zero
// candidate intents parsed); `sendCapture` must key off `capture.status`,
// not `res.ok`, to avoid landing on a blank, unexplained delivery card.
// ---------------------------------------------------------------------------

describe('resolveCaptureOutcome', () => {
  it('returns an error outcome when status is "failed", using the kernel-provided message', () => {
    const outcome = resolveCaptureOutcome(
      { sessionId: 's1', status: 'failed', error: 'No candidate intents inferred' },
      undefined,
    );
    expect(outcome).toEqual({ kind: 'error', errorMessage: 'No candidate intents inferred' });
  });

  it('falls back to a default message when status is "failed" but no error string is provided', () => {
    const outcome = resolveCaptureOutcome({ sessionId: 's1', status: 'failed' }, undefined);
    expect(outcome.kind).toBe('error');
    if (outcome.kind === 'error') {
      expect(outcome.errorMessage).toMatch(/try again or fill in manually/i);
    }
  });

  it('returns an editing outcome with a notice when candidateIntents is empty and there is no prior lot', () => {
    const outcome = resolveCaptureOutcome(
      { sessionId: 's1', status: 'ok', candidateIntents: [] },
      undefined,
    );
    expect(outcome.kind).toBe('editing');
    if (outcome.kind === 'editing') {
      expect(outcome.notice).toBeDefined();
      expect(outcome.fields.product).toBe('');
    }
  });

  it('returns an editing outcome with a notice when candidateIntents is absent entirely and there is no prior lot', () => {
    const outcome = resolveCaptureOutcome({ sessionId: 's1', status: 'ok' }, undefined);
    expect(outcome.kind).toBe('editing');
    if (outcome.kind === 'editing') {
      expect(outcome.notice).toBeDefined();
    }
  });

  it('does not show a notice when a prior lot can seed the fields, even with no inferred metadata', () => {
    const outcome = resolveCaptureOutcome(
      { sessionId: 's1', status: 'ok', candidateIntents: [] },
      RECENT_LOT,
    );
    expect(outcome.kind).toBe('editing');
    if (outcome.kind === 'editing') {
      expect(outcome.notice).toBeUndefined();
      expect(outcome.fields.product).toBe('eggs');
    }
  });

  it('returns a plain editing outcome with no notice on a successful parse', () => {
    const outcome = resolveCaptureOutcome(
      {
        sessionId: 's1',
        status: 'ok',
        candidateIntents: [
          { intentType: 'delivery', metadata: { product: 'eggs', qty: 6, recipient: 'David' } },
        ],
      },
      undefined,
    );
    expect(outcome).toEqual({
      kind: 'editing',
      fields: { product: 'eggs', qty: '6', unit: '', recipient: 'David', lot: '', notes: '' },
    });
  });
});
