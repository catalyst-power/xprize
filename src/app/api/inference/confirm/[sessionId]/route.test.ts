import { describe, it, expect, vi, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from './route';

vi.mock('@/lib/session', () => ({ getSession: vi.fn() }));
vi.mock('@/lib/inference', () => ({ confirmInference: vi.fn() }));
vi.mock('@/lib/kernel/chat', () => ({ sendDirectMessage: vi.fn() }));
vi.mock('@/lib/supply', () => ({ materializeInferenceSupplyLot: vi.fn() }));

import { getSession } from '@/lib/session';
import { confirmInference } from '@/lib/inference';
import { sendDirectMessage } from '@/lib/kernel/chat';
import { materializeInferenceSupplyLot } from '@/lib/supply';

const mockGetSession = vi.mocked(getSession);
const mockConfirm = vi.mocked(confirmInference);
const mockSendDirectMessage = vi.mocked(sendDirectMessage);
const mockMaterialize = vi.mocked(materializeInferenceSupplyLot);

afterEach(() => {
  vi.resetAllMocks();
});

/** Flush the microtask queue so a fire-and-forget promise chain settles before assertions run. */
async function flushMicrotasks(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SESSION_USER = {
  did: 'did:imajin:scott',
  displayName: 'Scott',
  handle: 'scott',
  attestationId: 'att-1',
};

const CONFIRM_RESPONSE = {
  sessionId: 'sess_abc',
  status: 'resolved' as const,
  attestationId: 'att_signed_123',
  intentType: 'supply.received',
  primitiveType: 'supply',
  externalId: 'ext_001',
  resolvedAt: '2026-07-25T12:00:00Z',
};

function makeRequest(sessionId: string, body?: object) {
  return new NextRequest(
    `http://localhost/api/inference/confirm/${sessionId}`,
    {
      method: 'POST',
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    },
  );
}

function makeParams(sessionId: string) {
  return { params: Promise.resolve({ sessionId }) };
}

// ---------------------------------------------------------------------------
// Auth guard
// ---------------------------------------------------------------------------

describe('POST /api/inference/confirm/[sessionId] — auth', () => {
  it('returns 401 when there is no session', async () => {
    mockGetSession.mockResolvedValue(null);

    const res = await POST(makeRequest('sess_abc'), makeParams('sess_abc'));

    expect(res.status).toBe(401);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('Unauthorized');
  });
});

// ---------------------------------------------------------------------------
// Happy path
// ---------------------------------------------------------------------------

describe('POST /api/inference/confirm/[sessionId] — success', () => {
  it('returns 200 with the confirm response', async () => {
    mockGetSession.mockResolvedValue(SESSION_USER);
    mockConfirm.mockResolvedValue(CONFIRM_RESPONSE);

    const res = await POST(makeRequest('sess_abc'), makeParams('sess_abc'));

    expect(res.status).toBe(200);
    const body = await res.json() as typeof CONFIRM_RESPONSE;
    expect(body.sessionId).toBe('sess_abc');
    expect(body.status).toBe('resolved');
    expect(body.attestationId).toBe('att_signed_123');
  });

  it('forwards the sessionId from route params to confirmInference', async () => {
    mockGetSession.mockResolvedValue(SESSION_USER);
    mockConfirm.mockResolvedValue(CONFIRM_RESPONSE);

    await POST(makeRequest('sess_xyz'), makeParams('sess_xyz'));

    expect(mockConfirm).toHaveBeenCalledWith('sess_xyz', SESSION_USER.attestationId, undefined);
  });

  it('calls confirmInference with no body when the request has no body (backward-compatible, pre-xprize#55 callers)', async () => {
    mockGetSession.mockResolvedValue(SESSION_USER);
    mockConfirm.mockResolvedValue(CONFIRM_RESPONSE);

    await POST(makeRequest('sess_abc'), makeParams('sess_abc'));

    expect(mockConfirm).toHaveBeenCalledWith('sess_abc', SESSION_USER.attestationId, undefined);
  });

  it('forwards the confirmed/edited card from the request body (xprize#55/#56)', async () => {
    mockGetSession.mockResolvedValue(SESSION_USER);
    mockConfirm.mockResolvedValue(CONFIRM_RESPONSE);

    const body = { recipient: 'did:imajin:david', lot: 'L1', notes: 'left at gate' };
    await POST(makeRequest('sess_abc', body), makeParams('sess_abc'));

    expect(mockConfirm).toHaveBeenCalledWith('sess_abc', SESSION_USER.attestationId, body);
  });

  it('returns 400 when the request body is present but not valid JSON', async () => {
    mockGetSession.mockResolvedValue(SESSION_USER);

    const badRequest = new NextRequest('http://localhost/api/inference/confirm/sess_abc', {
      method: 'POST',
      body: '{not json',
    });

    const res = await POST(badRequest, makeParams('sess_abc'));

    expect(res.status).toBe(400);
    expect(mockConfirm).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Kernel failure
// ---------------------------------------------------------------------------

describe('POST /api/inference/confirm/[sessionId] — kernel failure', () => {
  it('returns 502 when confirmInference throws', async () => {
    mockGetSession.mockResolvedValue(SESSION_USER);
    mockConfirm.mockRejectedValue(
      new Error('inference.confirm failed: 500 Internal Server Error'),
    );

    const res = await POST(makeRequest('sess_abc'), makeParams('sess_abc'));

    expect(res.status).toBe(502);
    const body = await res.json() as { error: string };
    expect(body.error).toContain('inference.confirm failed');
  });
});

// ---------------------------------------------------------------------------
// Counterparty notification (xprize#73)
// ---------------------------------------------------------------------------

describe('POST /api/inference/confirm/[sessionId] — counterparty notification', () => {
  it('sends a chat DM to the confirmed recipient, linking to the dashboard lot', async () => {
    mockGetSession.mockResolvedValue(SESSION_USER);
    mockConfirm.mockResolvedValue(CONFIRM_RESPONSE);
    mockSendDirectMessage.mockResolvedValue(undefined);

    await POST(
      makeRequest('sess_abc', { recipient: 'did:imajin:david', lot: 'L1', notes: '' }),
      makeParams('sess_abc'),
    );
    await flushMicrotasks();

    expect(mockSendDirectMessage).toHaveBeenCalledOnce();
    const [recipientDid, text, attestationId] = mockSendDirectMessage.mock.calls[0];
    expect(recipientDid).toBe('did:imajin:david');
    expect(text).toContain(`dashboard?lot=${CONFIRM_RESPONSE.externalId}`);
    expect(attestationId).toBe(SESSION_USER.attestationId);
  });

  it('does not notify when the confirmed card has no recipient', async () => {
    mockGetSession.mockResolvedValue(SESSION_USER);
    mockConfirm.mockResolvedValue(CONFIRM_RESPONSE);

    await POST(makeRequest('sess_abc'), makeParams('sess_abc'));
    await flushMicrotasks();

    expect(mockSendDirectMessage).not.toHaveBeenCalled();
  });

  it('still returns 200 with the confirm result when the notification fails (non-blocking)', async () => {
    mockGetSession.mockResolvedValue(SESSION_USER);
    mockConfirm.mockResolvedValue(CONFIRM_RESPONSE);
    mockSendDirectMessage.mockRejectedValue(new Error('chat.messages.send failed: 403 Soft DID'));
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const res = await POST(
      makeRequest('sess_abc', { recipient: 'did:imajin:david' }),
      makeParams('sess_abc'),
    );
    await flushMicrotasks();

    expect(res.status).toBe(200);
    const body = await res.json() as typeof CONFIRM_RESPONSE;
    expect(body.attestationId).toBe(CONFIRM_RESPONSE.attestationId);
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Counterparty delivery notification failed'),
      expect.anything(),
    );

    consoleErrorSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// Supply lot materialization (xprize#88)
// ---------------------------------------------------------------------------

describe('POST /api/inference/confirm/[sessionId] — supply lot materialization', () => {
  const CONFIRMED_LINE = {
    product: { label: 'eggs' },
    qty: 6,
    unit: 'dozen',
    unitPrice: 0,
    currency: 'USD',
    total: 0,
    priceBasis: 'per_unit' as const,
  };

  it('materializes the supply lot with the confirmed line and recipient, threaded on the resolved correlationId', async () => {
    mockGetSession.mockResolvedValue(SESSION_USER);
    mockConfirm.mockResolvedValue(CONFIRM_RESPONSE);
    mockMaterialize.mockResolvedValue({ ok: true, correlationId: CONFIRM_RESPONSE.externalId, stage: 'received' });

    await POST(
      makeRequest('sess_abc', { recipient: 'did:imajin:david', lines: [CONFIRMED_LINE] }),
      makeParams('sess_abc'),
    );

    expect(mockMaterialize).toHaveBeenCalledOnce();
    const [request, attestationId] = mockMaterialize.mock.calls[0];
    expect(request).toEqual({
      lotId: CONFIRM_RESPONSE.externalId,
      commodity: 'eggs',
      quantity: 6,
      unit: 'dozen',
      recipientDid: 'did:imajin:david',
    });
    expect(attestationId).toBe(SESSION_USER.attestationId);
  });

  it('omits recipientDid when the confirmed card has no recipient', async () => {
    mockGetSession.mockResolvedValue(SESSION_USER);
    mockConfirm.mockResolvedValue(CONFIRM_RESPONSE);
    mockMaterialize.mockResolvedValue(undefined);

    await POST(makeRequest('sess_abc', { lines: [CONFIRMED_LINE] }), makeParams('sess_abc'));

    expect(mockMaterialize).toHaveBeenCalledOnce();
    const [request] = mockMaterialize.mock.calls[0];
    expect('recipientDid' in request).toBe(false);
  });

  it('skips materialization when the confirmed body has no line items (bare confirm call)', async () => {
    mockGetSession.mockResolvedValue(SESSION_USER);
    mockConfirm.mockResolvedValue(CONFIRM_RESPONSE);

    await POST(makeRequest('sess_abc'), makeParams('sess_abc'));

    expect(mockMaterialize).not.toHaveBeenCalled();
  });

  it('skips materialization when confirmInference did not resolve a lot correlationId', async () => {
    mockGetSession.mockResolvedValue(SESSION_USER);
    mockConfirm.mockResolvedValue({ ...CONFIRM_RESPONSE, externalId: '' });

    await POST(
      makeRequest('sess_abc', { recipient: 'did:imajin:david', lines: [CONFIRMED_LINE] }),
      makeParams('sess_abc'),
    );

    expect(mockMaterialize).not.toHaveBeenCalled();
  });

  it('still returns 200 with the confirm result when materialization fails (non-blocking, additive)', async () => {
    mockGetSession.mockResolvedValue(SESSION_USER);
    mockConfirm.mockResolvedValue(CONFIRM_RESPONSE);
    mockMaterialize.mockRejectedValue(new Error('supply.received (inference bridge) failed: 500'));
    mockSendDirectMessage.mockResolvedValue(undefined);
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const res = await POST(
      makeRequest('sess_abc', { recipient: 'did:imajin:david', lines: [CONFIRMED_LINE] }),
      makeParams('sess_abc'),
    );

    expect(res.status).toBe(200);
    const body = await res.json() as typeof CONFIRM_RESPONSE;
    expect(body.attestationId).toBe(CONFIRM_RESPONSE.attestationId);
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Failed to materialize supply lot'),
      expect.anything(),
    );

    consoleErrorSpy.mockRestore();
  });
});
