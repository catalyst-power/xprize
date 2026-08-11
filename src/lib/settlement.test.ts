import { describe, it, expect } from 'vitest';
import {
  isBilateralReceipt,
  extractReceiptLines,
  receiptTotalCents,
  validateReceiptForInvoicing,
  buildInvoiceLines,
  buildFairManifest,
} from './settlement';
import type { AttestationRecord } from './kernel/attestations';
import type { LotChain, LotChainStage } from './supply';

// ---------------------------------------------------------------------------
// isBilateralReceipt
// ---------------------------------------------------------------------------

describe('isBilateralReceipt', () => {
  const BASE: AttestationRecord = {
    id: 'att_1',
    issuerDid: 'did:imajin:scott',
    subjectDid: 'did:imajin:scott',
    type: 'supply.received',
    contextId: 'lot_1',
    contextType: 'supply',
    cid: 'bafy1',
    attestationStatus: 'bilateral',
    issuedAt: '2026-01-01T00:00:00Z',
  };

  it('returns true for a bilateral supply.received attestation matching the lot', () => {
    expect(isBilateralReceipt([BASE], 'lot_1')).toBe(true);
  });

  it('returns false when the attestation is only pending', () => {
    expect(isBilateralReceipt([{ ...BASE, attestationStatus: 'pending' }], 'lot_1')).toBe(false);
  });

  it('returns false when the type is not supply.received', () => {
    expect(isBilateralReceipt([{ ...BASE, type: 'other.type' }], 'lot_1')).toBe(false);
  });

  it('returns false when the contextId is for a different lot', () => {
    expect(isBilateralReceipt([{ ...BASE, contextId: 'lot_2' }], 'lot_1')).toBe(false);
  });

  it('returns false for an empty attestation list', () => {
    expect(isBilateralReceipt([], 'lot_1')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// extractReceiptLines / receiptTotalCents
// ---------------------------------------------------------------------------

function stageWithPayload(payload: unknown): LotChainStage {
  return {
    stage: 'received',
    actorDid: 'did:imajin:scott',
    attestationCid: 'bafy_received',
    priorCid: 'bafy_declared',
    payload,
    createdAt: '2026-01-01T00:00:00Z',
  };
}

describe('extractReceiptLines', () => {
  it('extracts valid lines with a string product label', () => {
    const stage = stageWithPayload({
      lines: [{ product: 'eggs', qty: 6, unit: 'dozen', total: 2400 }],
    });
    expect(extractReceiptLines(stage)).toEqual([{ product: 'eggs', qty: 6, unit: 'dozen', total: 2400 }]);
  });

  it('extracts the label from a { label } product ref object', () => {
    const stage = stageWithPayload({
      lines: [{ product: { label: 'eggs' }, qty: 6, unit: 'dozen', total: 2400 }],
    });
    expect(extractReceiptLines(stage)).toEqual([{ product: 'eggs', qty: 6, unit: 'dozen', total: 2400 }]);
  });

  it('returns [] when payload has no lines array (legacy single-product shape)', () => {
    const stage = stageWithPayload({ commodity: 'eggs', quantity: 6, unit: 'dozen' });
    expect(extractReceiptLines(stage)).toEqual([]);
  });

  it('returns [] for a null payload', () => {
    expect(extractReceiptLines(stageWithPayload(null))).toEqual([]);
  });

  it('skips malformed line entries (missing/wrong-typed fields) rather than throwing', () => {
    const stage = stageWithPayload({
      lines: [
        { product: 'eggs', qty: 6, unit: 'dozen', total: 2400 },
        { product: 'eggs' }, // missing qty/unit/total
        { qty: 'six', unit: 'dozen', total: 2400 }, // qty wrong type
      ],
    });
    expect(extractReceiptLines(stage)).toEqual([{ product: 'eggs', qty: 6, unit: 'dozen', total: 2400 }]);
  });
});

describe('receiptTotalCents', () => {
  it('sums every line total', () => {
    expect(
      receiptTotalCents([
        { product: 'eggs', qty: 6, unit: 'dozen', total: 2400 },
        { product: 'milk', qty: 2, unit: 'litre', total: 600 },
      ]),
    ).toBe(3000);
  });

  it('returns 0 for an empty line list', () => {
    expect(receiptTotalCents([])).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// validateReceiptForInvoicing — the fail-closed gate (xprize#58 bug class)
// ---------------------------------------------------------------------------

function chainWithStages(stages: LotChainStage[]): LotChain {
  return {
    lot: { correlationId: 'lot_1', originatingDid: 'did:imajin:scott', commodity: 'eggs', status: 'received', createdAt: '2026-01-01T00:00:00Z' },
    stages,
  };
}

describe('validateReceiptForInvoicing', () => {
  it('fails closed when there is no received stage yet', () => {
    const result = validateReceiptForInvoicing(chainWithStages([]));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('no received stage');
  });

  it('fails closed when the received stage has no lines', () => {
    const result = validateReceiptForInvoicing(
      chainWithStages([stageWithPayload({ commodity: 'eggs', quantity: 6, unit: 'dozen' })]),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('no packing-slip lines');
  });

  it('fails closed when the manifest total is zero (xprize#58)', () => {
    const result = validateReceiptForInvoicing(
      chainWithStages([stageWithPayload({ lines: [{ product: 'eggs', qty: 6, unit: 'dozen', total: 0 }] })]),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('zero');
  });

  it('succeeds with lines + totalCents for a valid manifest', () => {
    const result = validateReceiptForInvoicing(
      chainWithStages([stageWithPayload({ lines: [{ product: 'eggs', qty: 6, unit: 'dozen', total: 2400 }] })]),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.totalCents).toBe(2400);
      expect(result.lines).toHaveLength(1);
    }
  });
});

// ---------------------------------------------------------------------------
// buildInvoiceLines
// ---------------------------------------------------------------------------

describe('buildInvoiceLines', () => {
  it('converts cents to dollars and derives a per-unit price', () => {
    const lines = buildInvoiceLines([{ product: 'eggs', qty: 6, unit: 'dozen', total: 2400 }], 'qb_item_1');
    expect(lines).toEqual([
      { amount: 24, itemRef: 'qb_item_1', description: 'eggs (6 dozen)', quantity: 6, unitPrice: 4 },
    ]);
  });

  it('omits unitPrice when qty is 0 (never divide by zero)', () => {
    const lines = buildInvoiceLines([{ product: 'eggs', qty: 0, unit: 'dozen', total: 0 }], 'qb_item_1');
    expect(lines[0].unitPrice).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// buildFairManifest
// ---------------------------------------------------------------------------

describe('buildFairManifest', () => {
  it('builds a single-recipient chain crediting the supplier the full dollar amount', () => {
    const manifest = buildFairManifest('did:imajin:scott', 2400);
    expect(manifest).toEqual({ chain: [{ did: 'did:imajin:scott', amount: 24, role: 'seller' }] });
  });
});
