import { describe, it, expect, vi, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from './route';

vi.mock('@/lib/session', () => ({ getSession: vi.fn() }));
vi.mock('@/lib/inference', () => ({ confirmInference: vi.fn() }));

import { getSession } from '@/lib/session';
import { confirmInference } from '@/lib/inference';

const mockGetSession = vi.mocked(getSession);
const mockConfirm = vi.mocked(confirmInference);

afterEach(() => {
  vi.resetAllMocks();
});

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

function makeRequest(sessionId: string) {
  return new NextRequest(
    `http://localhost/api/inference/confirm/${sessionId}`,
    { method: 'POST' },
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

    expect(mockConfirm).toHaveBeenCalledWith('sess_xyz', SESSION_USER.attestationId);
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
