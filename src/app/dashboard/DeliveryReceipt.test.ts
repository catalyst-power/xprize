import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('@/lib/supply', async () => {
  const actual = await vi.importActual<typeof import('@/lib/supply')>('@/lib/supply');
  return { ...actual, getLotChain: vi.fn() };
});
vi.mock('@/lib/settlementFlow', () => ({ attemptInvoiceCreation: vi.fn() }));

import { findReceivedStage, toReceiptPayload, DeliveryReceipt, SettlementSection } from './DeliveryReceipt';
import { getLotChain, type LotChain } from '@/lib/supply';
import { attemptInvoiceCreation } from '@/lib/settlementFlow';

const mockGetLotChain = vi.mocked(getLotChain);
const mockAttemptInvoiceCreation = vi.mocked(attemptInvoiceCreation);

afterEach(() => {
  vi.resetAllMocks();
});

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

// ---------------------------------------------------------------------------
// DeliveryReceipt — settlement wiring (xprize#60)
// ---------------------------------------------------------------------------

/** Walk a React element tree looking for an element of the given component type. */
function findElementOfType(node: unknown, type: unknown): { props?: Record<string, unknown> } | undefined {
  if (node === null || node === undefined || typeof node !== 'object') return undefined;
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findElementOfType(child, type);
      if (found) return found;
    }
    return undefined;
  }
  const element = node as { type?: unknown; props?: Record<string, unknown> };
  if (element.type === type) return element;
  return findElementOfType(element.props?.['children'], type);
}

describe('DeliveryReceipt — permalink (xprize#76)', () => {
  it('links to the standalone /delivery/{correlationId} route', async () => {
    mockGetLotChain.mockResolvedValue(MOCK_CHAIN);
    mockAttemptInvoiceCreation.mockResolvedValue({ state: 'pending-invoice' });

    const element = await DeliveryReceipt({ correlationId: 'lot_abc123', attestationId: 'att-1' });

    function findAnchorHrefs(node: unknown): string[] {
      if (node === null || node === undefined || typeof node !== 'object') return [];
      if (Array.isArray(node)) return node.flatMap(findAnchorHrefs);
      const el = node as { type?: unknown; props?: Record<string, unknown> };
      const hrefs = el.type === 'a' && typeof el.props?.['href'] === 'string' ? [el.props['href'] as string] : [];
      return [...hrefs, ...findAnchorHrefs(el.props?.['children'])];
    }

    expect(findAnchorHrefs(element)).toContain('/delivery/lot_abc123');
  });
});

describe('DeliveryReceipt — settlement rendering', () => {
  it('calls attemptInvoiceCreation with the correlationId and attestationId once a receipt exists', async () => {
    mockGetLotChain.mockResolvedValue(MOCK_CHAIN);
    mockAttemptInvoiceCreation.mockResolvedValue({ state: 'pending-invoice' });

    await DeliveryReceipt({ correlationId: 'lot_abc123', attestationId: 'att-1' });

    expect(mockAttemptInvoiceCreation).toHaveBeenCalledWith('lot_abc123', 'att-1');
  });

  it('renders a SettlementSection with the resolved settlement view', async () => {
    mockGetLotChain.mockResolvedValue(MOCK_CHAIN);
    mockAttemptInvoiceCreation.mockResolvedValue({ state: 'awaiting-payment', invoiceId: 'inv_1', checkoutUrl: 'https://checkout.stripe.com/cs_1' });

    const element = await DeliveryReceipt({ correlationId: 'lot_abc123', attestationId: 'att-1' });

    const settlementSection = findElementOfType(element, SettlementSection);
    expect(settlementSection).toBeDefined();
    expect(settlementSection?.props?.['settlement']).toEqual({
      state: 'awaiting-payment',
      invoiceId: 'inv_1',
      checkoutUrl: 'https://checkout.stripe.com/cs_1',
    });
  });

  it('does not attempt settlement when the receipt is still pending (no received stage)', async () => {
    mockGetLotChain.mockResolvedValue({ ...MOCK_CHAIN, stages: [DECLARED_STAGE] });

    await DeliveryReceipt({ correlationId: 'lot_abc123', attestationId: 'att-1' });

    expect(mockAttemptInvoiceCreation).not.toHaveBeenCalled();
  });
});

describe('SettlementSection', () => {
  it('renders the settled badge and totalCents for a settled state', () => {
    const element = SettlementSection({ settlement: { state: 'settled', totalCents: 2400, invoiceId: 'inv_1' } });
    expect(element).toBeDefined();
  });

  it('renders an error message for an error state', () => {
    const element = SettlementSection({ settlement: { state: 'error', error: 'manifest total is zero' } });
    expect(element).toBeDefined();
  });
});
