import { describe, it, expect, vi, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from './route';

vi.mock('@/lib/session', () => ({ getSession: vi.fn() }));
vi.mock('@/lib/settlementFlow', () => ({ attemptInvoiceCreation: vi.fn() }));

import { getSession } from '@/lib/session';
import { attemptInvoiceCreation } from '@/lib/settlementFlow';

const mockGetSession = vi.mocked(getSession);
const mockAttempt = vi.mocked(attemptInvoiceCreation);

afterEach(() => {
  vi.resetAllMocks();
});

const SESSION_USER = {
  did: 'did:imajin:scott',
  displayName: 'Scott',
  handle: 'scott',
  attestationId: 'att-1',
};

function makeRequest() {
  return new NextRequest('http://localhost/api/supply/settle/lot_1', { method: 'POST' });
}

function makeParams(correlationId: string) {
  return { params: Promise.resolve({ correlationId }) };
}

describe('POST /api/supply/settle/[correlationId] — auth', () => {
  it('returns 401 when there is no session', async () => {
    mockGetSession.mockResolvedValue(null);

    const res = await POST(makeRequest(), makeParams('lot_1'));

    expect(res.status).toBe(401);
    expect(mockAttempt).not.toHaveBeenCalled();
  });
});

describe('POST /api/supply/settle/[correlationId] — success', () => {
  it("delegates to attemptInvoiceCreation with the route's correlationId and the session's attestationId", async () => {
    mockGetSession.mockResolvedValue(SESSION_USER);
    mockAttempt.mockResolvedValue({ state: 'pending-invoice' });

    await POST(makeRequest(), makeParams('lot_1'));

    expect(mockAttempt).toHaveBeenCalledWith('lot_1', 'att-1');
  });

  it('returns the SettlementView as JSON with status 200', async () => {
    mockGetSession.mockResolvedValue(SESSION_USER);
    mockAttempt.mockResolvedValue({ state: 'awaiting-payment', invoiceId: 'inv_1', checkoutUrl: 'https://checkout.stripe.com/cs_1' });

    const res = await POST(makeRequest(), makeParams('lot_1'));

    expect(res.status).toBe(200);
    const body = await res.json() as { state: string; invoiceId?: string };
    expect(body.state).toBe('awaiting-payment');
    expect(body.invoiceId).toBe('inv_1');
  });
});
