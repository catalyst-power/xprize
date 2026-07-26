import { describe, it, expect } from 'vitest';
import { findReceivedStage, toReceiptPayload } from './DeliveryReceipt';
import type { LotChain } from '@/lib/supply';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const DECLARED_STAGE = {
  stage: 'declared',
  actorDid: 'did:imajin:scott',
  attestationCid: 'bafkreideclared',
  priorCid: null,
  payload: { commodity: 'eggs', quantity: 6, unit: 'dozen' },
  createdAt: '2026-01-01T00:00:00Z',
};

const RECEIVED_STAGE = {
  stage: 'received',
  actorDid: 'did:imajin:scott',
  attestationCid: 'bafkreireceived',
  priorCid: 'bafkreideclared',
  payload: { commodity: 'eggs', quantity: 6, unit: 'dozen', recipient: 'Grace Harbour Farms' },
  createdAt: '2026-01-01T01:00:00Z',
};

const MOCK_CHAIN: LotChain = {
  lot: {
    correlationId: 'lot_abc123',
    originatingDid: 'did:imajin:scott',
    commodity: 'eggs',
    status: 'received',
    createdAt: '2026-01-01T00:00:00Z',
  },
  stages: [DECLARED_STAGE, RECEIVED_STAGE],
};

// ---------------------------------------------------------------------------
// findReceivedStage
// ---------------------------------------------------------------------------

describe('findReceivedStage', () => {
  it('returns the received stage when present', () => {
    const stage = findReceivedStage(MOCK_CHAIN);
    expect(stage?.stage).toBe('received');
  });

  it('returns the correct actorDid and attestationCid from the received stage', () => {
    const stage = findReceivedStage(MOCK_CHAIN);
    expect(stage?.actorDid).toBe('did:imajin:scott');
    expect(stage?.attestationCid).toBe('bafkreireceived');
    expect(stage?.priorCid).toBe('bafkreideclared');
  });

  it('returns undefined when there is no received stage (receipt pending)', () => {
    const chainWithoutReceived: LotChain = { ...MOCK_CHAIN, stages: [DECLARED_STAGE] };
    expect(findReceivedStage(chainWithoutReceived)).toBeUndefined();
  });

  it('returns undefined for an empty stages array', () => {
    const emptyChain: LotChain = { ...MOCK_CHAIN, stages: [] };
    expect(findReceivedStage(emptyChain)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// toReceiptPayload
// ---------------------------------------------------------------------------

describe('toReceiptPayload', () => {
  it('extracts commodity, quantity (as string), unit, and recipient from a full payload', () => {
    const p = toReceiptPayload({
      commodity: 'eggs',
      quantity: 6,
      unit: 'dozen',
      recipient: 'Grace Harbour Farms',
    });
    expect(p.commodity).toBe('eggs');
    expect(p.quantity).toBe('6');
    expect(p.unit).toBe('dozen');
    expect(p.recipient).toBe('Grace Harbour Farms');
  });

  it('converts quantity number to string (signed asserted value, never recomputed)', () => {
    const p = toReceiptPayload({ quantity: 72 });
    expect(p.quantity).toBe('72');
  });

  it('returns null for missing optional fields', () => {
    const p = toReceiptPayload({ commodity: 'eggs' });
    expect(p.recipient).toBeNull();
    expect(p.quantity).toBeNull();
    expect(p.unit).toBeNull();
  });

  it('returns all nulls for a null payload', () => {
    const p = toReceiptPayload(null);
    expect(p.commodity).toBeNull();
    expect(p.quantity).toBeNull();
    expect(p.unit).toBeNull();
    expect(p.recipient).toBeNull();
  });

  it('returns all nulls for a non-object payload (string)', () => {
    const p = toReceiptPayload('unexpected string');
    expect(p.commodity).toBeNull();
    expect(p.recipient).toBeNull();
  });

  it('returns all nulls for a non-object payload (number)', () => {
    const p = toReceiptPayload(42);
    expect(p.quantity).toBeNull();
  });

  it('returns null when quantity is a string (not a signed number)', () => {
    // Quantity must be a number to be the signed asserted value; string is rejected.
    const p = toReceiptPayload({ quantity: 'six' });
    expect(p.quantity).toBeNull();
  });
});
