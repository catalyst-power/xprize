import { describe, it, expect, vi, afterEach } from 'vitest';
import { declareSupplyLot, confirmDelivery } from './supply';

vi.mock('./kernel/client', () => ({ fetchKernel: vi.fn() }));

import { fetchKernel } from './kernel/client';

const mockFetch = vi.mocked(fetchKernel);

afterEach(() => {
  vi.resetAllMocks();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

const DECLARED_RESPONSE = { ok: true, correlationId: 'lot_abc123', stage: 'declared' };
const RECEIVED_RESPONSE = { ok: true, correlationId: 'lot_abc123', stage: 'received' };

// ---------------------------------------------------------------------------
// declareSupplyLot
// ---------------------------------------------------------------------------

describe('declareSupplyLot', () => {
  it('POSTs to /supply/api/declared with commodity/quantity/unit', async () => {
    mockFetch.mockReturnValue(okResponse(DECLARED_RESPONSE));

    await declareSupplyLot({ commodity: 'eggs', quantity: 6, unit: 'dozen' });

    expect(mockFetch).toHaveBeenCalledOnce();
    const [path, opts] = mockFetch.mock.calls[0];
    expect(path).toBe('/supply/api/declared');
    expect(opts?.method).toBe('POST');
    expect(JSON.parse(opts?.body as string)).toEqual({ commodity: 'eggs', quantity: 6, unit: 'dozen' });
  });

  it('returns the parsed SupplyStageResponse on success', async () => {
    mockFetch.mockReturnValue(okResponse(DECLARED_RESPONSE));

    const result = await declareSupplyLot({ commodity: 'eggs', quantity: 6, unit: 'dozen' });

    expect(result.ok).toBe(true);
    expect(result.correlationId).toBe('lot_abc123');
    expect(result.stage).toBe('declared');
  });

  it('throws with status + error message on kernel error response', async () => {
    mockFetch.mockReturnValue(errorResponse(400, { error: 'commodity is required' }));

    await expect(
      declareSupplyLot({ commodity: '', quantity: 6, unit: 'dozen' }),
    ).rejects.toThrow('supply.declared failed: 400');
  });
});

// ---------------------------------------------------------------------------
// confirmDelivery
// ---------------------------------------------------------------------------

describe('confirmDelivery', () => {
  it('POSTs to /supply/api/received with lotId threaded from declared correlationId', async () => {
    mockFetch.mockReturnValue(okResponse(RECEIVED_RESPONSE));

    await confirmDelivery({ lotId: 'lot_abc123', commodity: 'eggs', quantity: 6, unit: 'dozen' });

    expect(mockFetch).toHaveBeenCalledOnce();
    const [path, opts] = mockFetch.mock.calls[0];
    expect(path).toBe('/supply/api/received');
    expect(opts?.method).toBe('POST');
    const sent = JSON.parse(opts?.body as string) as Record<string, unknown>;
    expect(sent.lotId).toBe('lot_abc123');
    expect(sent.commodity).toBe('eggs');
  });

  it('includes priorCid in the body when provided', async () => {
    mockFetch.mockReturnValue(okResponse(RECEIVED_RESPONSE));

    await confirmDelivery({
      lotId: 'lot_abc123',
      commodity: 'eggs',
      quantity: 6,
      unit: 'dozen',
      priorCid: 'bafkreiabc',
    });

    const [, opts] = mockFetch.mock.calls[0];
    const sent = JSON.parse(opts?.body as string) as Record<string, unknown>;
    expect(sent.priorCid).toBe('bafkreiabc');
  });

  it('omits priorCid when not provided', async () => {
    mockFetch.mockReturnValue(okResponse(RECEIVED_RESPONSE));

    await confirmDelivery({ lotId: 'lot_abc123', commodity: 'eggs', quantity: 6, unit: 'dozen' });

    const [, opts] = mockFetch.mock.calls[0];
    const sent = JSON.parse(opts?.body as string) as Record<string, unknown>;
    expect('priorCid' in sent).toBe(false);
  });

  it('returns the parsed SupplyStageResponse on success', async () => {
    mockFetch.mockReturnValue(okResponse(RECEIVED_RESPONSE));

    const result = await confirmDelivery({ lotId: 'lot_abc123', commodity: 'eggs', quantity: 6, unit: 'dozen' });

    expect(result.ok).toBe(true);
    expect(result.correlationId).toBe('lot_abc123');
    expect(result.stage).toBe('received');
  });

  it('throws with status + error message on kernel error response', async () => {
    mockFetch.mockReturnValue(errorResponse(400, { error: 'lotId is required' }));

    await expect(
      confirmDelivery({ lotId: '', commodity: 'eggs', quantity: 6, unit: 'dozen' }),
    ).rejects.toThrow('supply.received failed: 400');
  });
});
