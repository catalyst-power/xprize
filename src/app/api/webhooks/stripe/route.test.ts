import { describe, it, expect, vi, afterEach } from 'vitest';
import { createHmac } from 'node:crypto';
import { NextRequest } from 'next/server';
import { POST } from './route';

vi.mock('@/lib/settlementFlow', () => ({ attemptSettleFromStripe: vi.fn() }));

import { attemptSettleFromStripe } from '@/lib/settlementFlow';

const mockSettle = vi.mocked(attemptSettleFromStripe);
const SECRET = 'whsec_test';

afterEach(() => {
  vi.resetAllMocks();
  vi.unstubAllEnvs();
});

function signedRequest(body: object, secret: string = SECRET, timestamp = Math.floor(Date.now() / 1000)) {
  const rawBody = JSON.stringify(body);
  const signature = createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
  return new NextRequest('http://localhost/api/webhooks/stripe', {
    method: 'POST',
    headers: { 'stripe-signature': `t=${timestamp},v1=${signature}` },
    body: rawBody,
  });
}

const CHECKOUT_COMPLETED_EVENT = {
  type: 'checkout.session.completed',
  data: { object: { id: 'cs_1', metadata: { correlationId: 'lot_1' } } },
};

describe('POST /api/webhooks/stripe — signature verification', () => {
  it('returns 500 when STRIPE_WEBHOOK_SECRET is not configured', async () => {
    vi.stubEnv('STRIPE_WEBHOOK_SECRET', '');

    const res = await POST(signedRequest(CHECKOUT_COMPLETED_EVENT));

    expect(res.status).toBe(500);
    expect(mockSettle).not.toHaveBeenCalled();
  });

  it('returns 400 for an invalid signature (fails closed before trusting the body)', async () => {
    vi.stubEnv('STRIPE_WEBHOOK_SECRET', SECRET);

    const res = await POST(signedRequest(CHECKOUT_COMPLETED_EVENT, 'wrong_secret'));

    expect(res.status).toBe(400);
    expect(mockSettle).not.toHaveBeenCalled();
  });
});

describe('POST /api/webhooks/stripe — checkout.session.completed', () => {
  it('resolves correlationId from session metadata and settles', async () => {
    vi.stubEnv('STRIPE_WEBHOOK_SECRET', SECRET);
    vi.stubEnv('APP_ATTESTATION_ID', 'att-app-1');
    vi.stubEnv('PLATFORM_DID', 'did:imajin:platform');
    mockSettle.mockResolvedValue({ state: 'settled' });

    const res = await POST(signedRequest(CHECKOUT_COMPLETED_EVENT));

    expect(res.status).toBe(200);
    expect(mockSettle).toHaveBeenCalledWith({
      correlationId: 'lot_1',
      attestationId: 'att-app-1',
      fromDid: 'did:imajin:platform',
    });
  });

  it('ignores a session with no correlationId metadata (not ours)', async () => {
    vi.stubEnv('STRIPE_WEBHOOK_SECRET', SECRET);
    const event = { type: 'checkout.session.completed', data: { object: { id: 'cs_2', metadata: {} } } };

    const res = await POST(signedRequest(event));

    expect(res.status).toBe(200);
    expect(mockSettle).not.toHaveBeenCalled();
  });

  it('acknowledges other event types without attempting to settle', async () => {
    vi.stubEnv('STRIPE_WEBHOOK_SECRET', SECRET);
    const event = { type: 'payment_intent.succeeded', data: { object: { id: 'pi_1', metadata: {} } } };

    const res = await POST(signedRequest(event));

    expect(res.status).toBe(200);
    expect(mockSettle).not.toHaveBeenCalled();
  });

  it('acknowledges (200) even when APP_ATTESTATION_ID/PLATFORM_DID are not configured (logs, does not throw)', async () => {
    vi.stubEnv('STRIPE_WEBHOOK_SECRET', SECRET);
    vi.stubEnv('APP_ATTESTATION_ID', '');
    vi.stubEnv('PLATFORM_DID', '');

    const res = await POST(signedRequest(CHECKOUT_COMPLETED_EVENT));

    expect(res.status).toBe(200);
    expect(mockSettle).not.toHaveBeenCalled();
  });
});
