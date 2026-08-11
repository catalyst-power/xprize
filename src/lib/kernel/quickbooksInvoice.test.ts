import { describe, it, expect, vi, afterEach } from 'vitest';
import { createQuickBooksInvoice } from './quickbooksInvoice';

vi.mock('./client', () => ({ fetchKernel: vi.fn() }));

import { fetchKernel } from './client';

const mockFetch = vi.mocked(fetchKernel);

afterEach(() => {
  vi.resetAllMocks();
});

function okResponse(body: object) {
  return Promise.resolve({
    ok: true,
    status: 201,
    statusText: 'Created',
    json: () => Promise.resolve(body),
  } as Response);
}

function errorResponse(status: number, body: object) {
  return Promise.resolve({
    ok: false,
    status,
    statusText: 'Error',
    json: () => Promise.resolve(body),
  } as Response);
}

const RESPONSE_BODY = {
  invoice: {
    id: 'inv_1',
    docNumber: '1001',
    customerName: 'Grace Harbour Farms',
    totalAmount: 24,
    balance: 24,
    currency: 'USD',
    txnDate: '2026-01-01',
    correlationId: 'lot_1',
  },
  fairManifest: { chain: [{ did: 'did:imajin:scott', share: 1 }] },
};

describe('createQuickBooksInvoice', () => {
  it('POSTs to /quickbooks/api/invoice with correlationId/customerRef/lines, passing attestationId to fetchKernel', async () => {
    mockFetch.mockReturnValue(okResponse(RESPONSE_BODY));

    await createQuickBooksInvoice(
      {
        correlationId: 'lot_1',
        customerRef: 'qb_cust_1',
        lines: [{ amount: 24, itemRef: 'qb_item_1', quantity: 6, unitPrice: 4 }],
      },
      'att-scott-123',
    );

    expect(mockFetch).toHaveBeenCalledOnce();
    const [path, opts, attestationId] = mockFetch.mock.calls[0];
    expect(path).toBe('/quickbooks/api/invoice');
    expect(opts?.method).toBe('POST');
    expect(JSON.parse(opts?.body as string)).toEqual({
      correlationId: 'lot_1',
      customerRef: 'qb_cust_1',
      lines: [{ amount: 24, itemRef: 'qb_item_1', quantity: 6, unitPrice: 4 }],
    });
    expect(attestationId).toBe('att-scott-123');
  });

  it('returns the parsed invoice + fairManifest on success', async () => {
    mockFetch.mockReturnValue(okResponse(RESPONSE_BODY));

    const result = await createQuickBooksInvoice(
      { correlationId: 'lot_1', customerRef: 'qb_cust_1', lines: [{ amount: 24, itemRef: 'qb_item_1' }] },
      'att-scott-123',
    );

    expect(result.invoice.id).toBe('inv_1');
    expect(result.invoice.correlationId).toBe('lot_1');
    expect(result.fairManifest).toEqual(RESPONSE_BODY.fairManifest);
  });

  it('throws with status + error message on a kernel error response', async () => {
    mockFetch.mockReturnValue(errorResponse(502, { error: 'quickbooks_no_grant' }));

    await expect(
      createQuickBooksInvoice(
        { correlationId: 'lot_1', customerRef: 'qb_cust_1', lines: [{ amount: 24, itemRef: 'qb_item_1' }] },
        'att-scott-123',
      ),
    ).rejects.toThrow('quickbooks.invoice.create failed: 502');
  });
});
