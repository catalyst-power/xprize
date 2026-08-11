import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./supply', () => ({ getLotChain: vi.fn(), getLotChainAsSelf: vi.fn() }));
vi.mock('./kernel/attestations', () => ({ isReceiptBilateral: vi.fn() }));
vi.mock('./kernel/quickbooksInvoice', () => ({ createQuickBooksInvoice: vi.fn() }));
vi.mock('./kernel/pay', () => ({ createCheckoutSession: vi.fn(), settleFair: vi.fn() }));

import { getLotChain, getLotChainAsSelf } from './supply';
import { isReceiptBilateral } from './kernel/attestations';
import { createQuickBooksInvoice } from './kernel/quickbooksInvoice';
import { createCheckoutSession, settleFair } from './kernel/pay';
import { attemptInvoiceCreation, attemptSettleFromStripe } from './settlementFlow';
import { __resetSettlementStoreForTests } from './settlementStore';
import type { LotChain } from './supply';

const mockGetLotChain = vi.mocked(getLotChain);
const mockGetLotChainAsSelf = vi.mocked(getLotChainAsSelf);
const mockIsBilateral = vi.mocked(isReceiptBilateral);
const mockCreateInvoice = vi.mocked(createQuickBooksInvoice);
const mockCreateCheckout = vi.mocked(createCheckoutSession);
const mockSettleFair = vi.mocked(settleFair);

const BILATERAL_CHAIN: LotChain = {
  lot: { correlationId: 'lot_1', originatingDid: 'did:imajin:scott', commodity: 'eggs', status: 'received', createdAt: '2026-01-01T00:00:00Z' },
  stages: [
    {
      stage: 'declared',
      actorDid: 'did:imajin:scott',
      attestationCid: 'bafy_declared',
      priorCid: null,
      payload: { commodity: 'eggs', quantity: 6, unit: 'dozen' },
      createdAt: '2026-01-01T00:00:00Z',
    },
    {
      stage: 'received',
      actorDid: 'did:imajin:scott',
      attestationCid: 'bafy_received',
      priorCid: 'bafy_declared',
      payload: { lines: [{ product: 'eggs', qty: 6, unit: 'dozen', total: 2400 }] },
      createdAt: '2026-01-01T01:00:00Z',
    },
  ],
};

beforeEach(() => {
  __resetSettlementStoreForTests();
  vi.resetAllMocks();
  vi.stubEnv('QUICKBOOKS_DEFAULT_ITEM_REF', 'qb_item_1');
  vi.stubEnv('QUICKBOOKS_DEFAULT_CUSTOMER_REF', 'qb_cust_1');
  vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://app.test');
});

// ---------------------------------------------------------------------------
// attemptInvoiceCreation — the bilateral gate is structural, not a convention
// ---------------------------------------------------------------------------

describe('attemptInvoiceCreation', () => {
  it('is a no-op (pending-invoice) when the receipt is not yet bilateral', async () => {
    mockGetLotChain.mockResolvedValue(BILATERAL_CHAIN);
    mockIsBilateral.mockResolvedValue(false);

    const result = await attemptInvoiceCreation('lot_1', 'att-scott-123');

    expect(result.state).toBe('pending-invoice');
    expect(mockCreateInvoice).not.toHaveBeenCalled();
  });

  it('creates the QBO invoice + checkout session once bilateral, with a valid manifest', async () => {
    mockGetLotChain.mockResolvedValue(BILATERAL_CHAIN);
    mockIsBilateral.mockResolvedValue(true);
    mockCreateInvoice.mockResolvedValue({
      invoice: { id: 'inv_1', docNumber: null, customerName: null, totalAmount: 24, balance: 24, currency: 'USD', txnDate: null, correlationId: 'lot_1' },
      fairManifest: {},
    });
    mockCreateCheckout.mockResolvedValue({ id: 'cs_1', url: 'https://checkout.stripe.com/cs_1', expiresAt: '2026-01-01T00:00:00Z', transactionId: 'tx_1' });

    const result = await attemptInvoiceCreation('lot_1', 'att-scott-123');

    expect(result.state).toBe('awaiting-payment');
    expect(result.invoiceId).toBe('inv_1');
    expect(result.checkoutUrl).toBe('https://checkout.stripe.com/cs_1');
    expect(mockCreateInvoice).toHaveBeenCalledWith(
      { correlationId: 'lot_1', customerRef: 'qb_cust_1', lines: [{ amount: 24, itemRef: 'qb_item_1', description: 'eggs (6 dozen)', quantity: 6, unitPrice: 4 }] },
      'att-scott-123',
    );
  });

  it('fails closed with an error state when the manifest total is zero (xprize#58)', async () => {
    const zeroChain: LotChain = {
      ...BILATERAL_CHAIN,
      stages: [
        { ...BILATERAL_CHAIN.stages[1], payload: { lines: [{ product: 'eggs', qty: 6, unit: 'dozen', total: 0 }] } },
      ],
    };
    mockGetLotChain.mockResolvedValue(zeroChain);
    mockIsBilateral.mockResolvedValue(true);

    const result = await attemptInvoiceCreation('lot_1', 'att-scott-123');

    expect(result.state).toBe('error');
    expect(mockCreateInvoice).not.toHaveBeenCalled();
  });

  it('fails closed with an error state when QUICKBOOKS_DEFAULT_ITEM_REF is not configured', async () => {
    vi.stubEnv('QUICKBOOKS_DEFAULT_ITEM_REF', '');
    mockGetLotChain.mockResolvedValue(BILATERAL_CHAIN);
    mockIsBilateral.mockResolvedValue(true);

    const result = await attemptInvoiceCreation('lot_1', 'att-scott-123');

    expect(result.state).toBe('error');
    expect(result.error).toContain('QUICKBOOKS_DEFAULT_ITEM_REF');
    expect(mockCreateInvoice).not.toHaveBeenCalled();
  });

  it('is idempotent — a second call for the same correlationId does not create a second invoice', async () => {
    mockGetLotChain.mockResolvedValue(BILATERAL_CHAIN);
    mockIsBilateral.mockResolvedValue(true);
    mockCreateInvoice.mockResolvedValue({
      invoice: { id: 'inv_1', docNumber: null, customerName: null, totalAmount: 24, balance: 24, currency: 'USD', txnDate: null, correlationId: 'lot_1' },
      fairManifest: {},
    });
    mockCreateCheckout.mockResolvedValue({ id: 'cs_1', url: 'https://checkout.stripe.com/cs_1', expiresAt: '2026-01-01T00:00:00Z', transactionId: 'tx_1' });

    await attemptInvoiceCreation('lot_1', 'att-scott-123');
    const second = await attemptInvoiceCreation('lot_1', 'att-scott-123');

    expect(mockCreateInvoice).toHaveBeenCalledOnce();
    expect(second.state).toBe('awaiting-payment');
    expect(second.invoiceId).toBe('inv_1');
  });

  it('does not create an invoice when the lot is already settled', async () => {
    mockGetLotChain.mockResolvedValue({ ...BILATERAL_CHAIN, lot: { ...BILATERAL_CHAIN.lot!, status: 'settled' } });

    const result = await attemptInvoiceCreation('lot_1', 'att-scott-123');

    expect(result.state).toBe('settled');
    expect(mockIsBilateral).not.toHaveBeenCalled();
    expect(mockCreateInvoice).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// attemptSettleFromStripe — paid hook -> canonical /pay/api/settle
// ---------------------------------------------------------------------------

describe('attemptSettleFromStripe', () => {
  it('reads the lot via getLotChainAsSelf (the app-service credential), never the borrowed-attestation getLotChain', async () => {
    mockGetLotChainAsSelf.mockResolvedValue(BILATERAL_CHAIN);
    mockIsBilateral.mockResolvedValue(true);
    mockSettleFair.mockResolvedValue({ settled: true, batchId: 'batch_1', transactions: ['tx_1'], total_amount: 24, recipients: 1, source: 'external' });

    await attemptSettleFromStripe({ correlationId: 'lot_1', fromDid: 'did:imajin:platform' });

    expect(mockGetLotChainAsSelf).toHaveBeenCalledWith('lot_1');
    expect(mockGetLotChain).not.toHaveBeenCalled();
  });

  it('settles once for a bilateral receipt with a valid manifest', async () => {
    mockGetLotChainAsSelf.mockResolvedValue(BILATERAL_CHAIN);
    mockIsBilateral.mockResolvedValue(true);
    mockSettleFair.mockResolvedValue({ settled: true, batchId: 'batch_1', transactions: ['tx_1'], total_amount: 24, recipients: 1, source: 'external' });

    const result = await attemptSettleFromStripe({ correlationId: 'lot_1', fromDid: 'did:imajin:platform' });

    expect(result.state).toBe('settled');
    expect(mockSettleFair).toHaveBeenCalledWith(
      expect.objectContaining({
        from_did: 'did:imajin:platform',
        total_amount: 24,
        fair_manifest: { chain: [{ did: 'did:imajin:scott', amount: 24, role: 'seller' }] },
        funded: true,
        funded_provider: 'stripe',
      }),
    );
  });

  it('is a no-op when the receipt is not bilateral (structural gate, never settle a pending claim)', async () => {
    mockGetLotChainAsSelf.mockResolvedValue(BILATERAL_CHAIN);
    mockIsBilateral.mockResolvedValue(false);

    const result = await attemptSettleFromStripe({ correlationId: 'lot_1', fromDid: 'did:imajin:platform' });

    expect(result.state).toBe('error');
    expect(mockSettleFair).not.toHaveBeenCalled();
  });

  it('is idempotent — a duplicate webhook delivery for an already-settled lot does not call settleFair again', async () => {
    mockGetLotChainAsSelf.mockResolvedValue(BILATERAL_CHAIN);
    mockIsBilateral.mockResolvedValue(true);
    mockSettleFair.mockResolvedValue({ settled: true, batchId: 'batch_1', transactions: ['tx_1'], total_amount: 24, recipients: 1, source: 'external' });

    await attemptSettleFromStripe({ correlationId: 'lot_1', fromDid: 'did:imajin:platform' });
    const second = await attemptSettleFromStripe({ correlationId: 'lot_1', fromDid: 'did:imajin:platform' });

    expect(mockSettleFair).toHaveBeenCalledOnce();
    expect(second.state).toBe('settled');
  });

  it('treats a lot already settled kernel-side (e.g. via the QBO auto-settle path) as settled without calling settleFair', async () => {
    mockGetLotChainAsSelf.mockResolvedValue({ ...BILATERAL_CHAIN, lot: { ...BILATERAL_CHAIN.lot!, status: 'settled' } });

    const result = await attemptSettleFromStripe({ correlationId: 'lot_1', fromDid: 'did:imajin:platform' });

    expect(result.state).toBe('settled');
    expect(mockSettleFair).not.toHaveBeenCalled();
  });

  it('surfaces a clear error state when the manifest is invalid rather than calling settleFair', async () => {
    const zeroChain: LotChain = {
      ...BILATERAL_CHAIN,
      stages: [
        { ...BILATERAL_CHAIN.stages[1], payload: { lines: [{ product: 'eggs', qty: 6, unit: 'dozen', total: 0 }] } },
      ],
    };
    mockGetLotChainAsSelf.mockResolvedValue(zeroChain);
    mockIsBilateral.mockResolvedValue(true);

    const result = await attemptSettleFromStripe({ correlationId: 'lot_1', fromDid: 'did:imajin:platform' });

    expect(result.state).toBe('error');
    expect(mockSettleFair).not.toHaveBeenCalled();
  });

  it('surfaces a clear error state (does not throw) when the app-service token mint fails', async () => {
    mockGetLotChainAsSelf.mockRejectedValue(
      new Error('Token mint failed: 401 Invalid proof-of-possession signature'),
    );

    const result = await attemptSettleFromStripe({ correlationId: 'lot_1', fromDid: 'did:imajin:platform' });

    expect(result.state).toBe('error');
    expect(result.error).toContain('Token mint failed');
    expect(mockIsBilateral).not.toHaveBeenCalled();
    expect(mockSettleFair).not.toHaveBeenCalled();
  });

  it('surfaces a clear error state (does not throw) when the kernel lot read fails (e.g. out-of-scope token)', async () => {
    mockGetLotChainAsSelf.mockRejectedValue(new Error('supply.lot.read failed: 403 insufficient scope'));

    const result = await attemptSettleFromStripe({ correlationId: 'lot_1', fromDid: 'did:imajin:platform' });

    expect(result.state).toBe('error');
    expect(result.error).toContain('supply.lot.read failed: 403');
    expect(mockSettleFair).not.toHaveBeenCalled();
  });
});
