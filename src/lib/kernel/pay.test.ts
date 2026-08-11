import { describe, it, expect, vi, afterEach } from 'vitest';
import { createCheckoutSession, settleFair } from './pay';

vi.mock('./client', () => ({ fetchKernel: vi.fn() }));

import { fetchKernel } from './client';

const mockFetchKernel = vi.mocked(fetchKernel);
const originalFetch = globalThis.fetch;

afterEach(() => {
  vi.resetAllMocks();
  globalThis.fetch = originalFetch;
  vi.unstubAllEnvs();
});

function okResponse(body: object) {
  return Promise.resolve({
    ok: true,
    status: 200,
    statusText: 'OK',
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

describe('createCheckoutSession', () => {
  it('POSTs to /pay/api/checkout via fetchKernel, passing attestationId', async () => {
    mockFetchKernel.mockReturnValue(
      okResponse({ id: 'cs_1', url: 'https://checkout.stripe.com/cs_1', expiresAt: '2026-01-01T00:00:00Z', transactionId: 'tx_1' }),
    );

    await createCheckoutSession(
      {
        items: [{ name: 'Delivery settlement', amount: 2400, quantity: 1 }],
        currency: 'usd',
        successUrl: 'https://app/dashboard?lot=lot_1',
        cancelUrl: 'https://app/dashboard?lot=lot_1',
        metadata: { correlationId: 'lot_1' },
      },
      'att-scott-123',
    );

    expect(mockFetchKernel).toHaveBeenCalledOnce();
    const [path, opts, attestationId] = mockFetchKernel.mock.calls[0];
    expect(path).toBe('/pay/api/checkout');
    expect(opts?.method).toBe('POST');
    expect(attestationId).toBe('att-scott-123');
  });

  it('throws with status + error message on a kernel error response', async () => {
    mockFetchKernel.mockReturnValue(errorResponse(429, { error: 'Too many requests' }));

    await expect(
      createCheckoutSession(
        { items: [], currency: 'usd', successUrl: 'x', cancelUrl: 'x', metadata: {} },
        'att-scott-123',
      ),
    ).rejects.toThrow('pay.checkout.create failed: 429');
  });
});

describe('settleFair', () => {
  it('throws a clear error when PAY_SERVICE_API_KEY is not configured', async () => {
    vi.stubEnv('PAY_SERVICE_API_KEY', '');

    await expect(
      settleFair({
        from_did: 'did:imajin:platform',
        total_amount: 24,
        service: 'agrifortress-supply',
        type: 'supply.settlement',
        fair_manifest: { chain: [{ did: 'did:imajin:scott', amount: 24, role: 'seller' }] },
      }),
    ).rejects.toThrow('PAY_SERVICE_API_KEY');
  });

  it('POSTs to {KERNEL_URL}/pay/api/settle with a service-API-key Bearer header (not app-auth)', async () => {
    vi.stubEnv('PAY_SERVICE_API_KEY', 'secret-key');
    vi.stubEnv('KERNEL_URL', 'https://kernel.test');
    const mockFetch = vi.fn().mockReturnValue(
      okResponse({ settled: true, batchId: 'batch_1', transactions: ['tx_1'], total_amount: 24, recipients: 1, source: 'external' }),
    );
    globalThis.fetch = mockFetch as unknown as typeof fetch;

    await settleFair({
      from_did: 'did:imajin:platform',
      total_amount: 24,
      service: 'agrifortress-supply',
      type: 'supply.settlement',
      fair_manifest: { chain: [{ did: 'did:imajin:scott', amount: 24, role: 'seller' }] },
      funded: true,
      funded_provider: 'stripe',
    });

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe('https://kernel.test/pay/api/settle');
    const headers = (opts as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer secret-key');
  });

  it('throws with status + error message on a kernel error response', async () => {
    vi.stubEnv('PAY_SERVICE_API_KEY', 'secret-key');
    globalThis.fetch = vi.fn().mockReturnValue(errorResponse(400, { error: 'Insufficient balance' })) as unknown as typeof fetch;

    await expect(
      settleFair({
        from_did: 'did:imajin:platform',
        total_amount: 24,
        service: 'agrifortress-supply',
        type: 'supply.settlement',
        fair_manifest: { chain: [{ did: 'did:imajin:scott', amount: 24, role: 'seller' }] },
      }),
    ).rejects.toThrow('pay.settle failed: 400');
  });
});
