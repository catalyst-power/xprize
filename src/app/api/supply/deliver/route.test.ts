import { describe, it, expect, vi, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from './route';

vi.mock('@/lib/session', () => ({ getSession: vi.fn() }));
vi.mock('@/lib/supply', () => ({
  declareSupplyLot: vi.fn(),
  confirmDelivery: vi.fn(),
}));

import { getSession } from '@/lib/session';
import { declareSupplyLot, confirmDelivery } from '@/lib/supply';

const mockGetSession = vi.mocked(getSession);
const mockDeclare = vi.mocked(declareSupplyLot);
const mockConfirm = vi.mocked(confirmDelivery);

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

const DECLARED = { ok: true, correlationId: 'lot_xyz', stage: 'declared' };
const RECEIVED = { ok: true, correlationId: 'lot_xyz', stage: 'received' };

function makeRequest(body: object) {
  return new NextRequest('http://localhost/api/supply/deliver', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// ---------------------------------------------------------------------------
// Auth guard
// ---------------------------------------------------------------------------

describe('POST /api/supply/deliver — auth', () => {
  it('returns 401 when there is no session', async () => {
    mockGetSession.mockResolvedValue(null);

    const res = await POST(makeRequest({ commodity: 'eggs', quantity: 6, unit: 'dozen' }));

    expect(res.status).toBe(401);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('Unauthorized');
  });
});

// ---------------------------------------------------------------------------
// Input validation
// ---------------------------------------------------------------------------

describe('POST /api/supply/deliver — validation', () => {
  it('returns 400 when commodity is missing', async () => {
    mockGetSession.mockResolvedValue(SESSION_USER);

    const res = await POST(makeRequest({ quantity: 6, unit: 'dozen' }));

    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toContain('commodity');
  });

  it('returns 400 when quantity is not a number', async () => {
    mockGetSession.mockResolvedValue(SESSION_USER);

    const res = await POST(makeRequest({ commodity: 'eggs', quantity: 'six', unit: 'dozen' }));

    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toContain('quantity');
  });

  it('returns 400 when unit is missing', async () => {
    mockGetSession.mockResolvedValue(SESSION_USER);

    const res = await POST(makeRequest({ commodity: 'eggs', quantity: 6 }));

    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toContain('unit');
  });
});

// ---------------------------------------------------------------------------
// Happy path — both stages succeed
// ---------------------------------------------------------------------------

describe('POST /api/supply/deliver — success', () => {
  it('returns 201 with declared and received when both kernel calls succeed', async () => {
    mockGetSession.mockResolvedValue(SESSION_USER);
    mockDeclare.mockResolvedValue(DECLARED);
    mockConfirm.mockResolvedValue(RECEIVED);

    const res = await POST(makeRequest({ commodity: 'eggs', quantity: 6, unit: 'dozen' }));

    expect(res.status).toBe(201);
    const body = await res.json() as { ok: boolean; declared: typeof DECLARED; received: typeof RECEIVED };
    expect(body.ok).toBe(true);
    expect(body.declared).toEqual(DECLARED);
    expect(body.received).toEqual(RECEIVED);
  });

  it('threads declared.correlationId as lotId into the received call', async () => {
    mockGetSession.mockResolvedValue(SESSION_USER);
    mockDeclare.mockResolvedValue(DECLARED);
    mockConfirm.mockResolvedValue(RECEIVED);

    await POST(makeRequest({ commodity: 'eggs', quantity: 6, unit: 'dozen' }));

    expect(mockConfirm).toHaveBeenCalledWith(
      expect.objectContaining({ lotId: 'lot_xyz' }),
    );
  });

  it('forwards priorCid to the received call when provided', async () => {
    mockGetSession.mockResolvedValue(SESSION_USER);
    mockDeclare.mockResolvedValue(DECLARED);
    mockConfirm.mockResolvedValue(RECEIVED);

    await POST(makeRequest({ commodity: 'eggs', quantity: 6, unit: 'dozen', priorCid: 'bafkreiabc' }));

    expect(mockConfirm).toHaveBeenCalledWith(
      expect.objectContaining({ priorCid: 'bafkreiabc' }),
    );
  });
});

// ---------------------------------------------------------------------------
// Partial failure — declared ok, received throws
// ---------------------------------------------------------------------------

describe('POST /api/supply/deliver — partial failure', () => {
  it('returns 207 with ok:false and error when received fails after declared succeeds', async () => {
    mockGetSession.mockResolvedValue(SESSION_USER);
    mockDeclare.mockResolvedValue(DECLARED);
    mockConfirm.mockRejectedValue(new Error('supply.received failed: 500 Internal Server Error'));

    const res = await POST(makeRequest({ commodity: 'eggs', quantity: 6, unit: 'dozen' }));

    expect(res.status).toBe(207);
    const body = await res.json() as {
      ok: boolean;
      declared: typeof DECLARED;
      received: null;
      error: string;
    };
    expect(body.ok).toBe(false);
    expect(body.declared).toEqual(DECLARED);
    expect(body.received).toBeNull();
    expect(body.error).toContain('lot_xyz');
    expect(body.error).toContain('declared but receipt was not signed');
  });
});

// ---------------------------------------------------------------------------
// Hard failure — declared throws
// ---------------------------------------------------------------------------

describe('POST /api/supply/deliver — hard failure', () => {
  it('returns 502 when declared itself fails', async () => {
    mockGetSession.mockResolvedValue(SESSION_USER);
    mockDeclare.mockRejectedValue(new Error('supply.declared failed: 503 Service Unavailable'));

    const res = await POST(makeRequest({ commodity: 'eggs', quantity: 6, unit: 'dozen' }));

    expect(res.status).toBe(502);
    const body = await res.json() as { error: string };
    expect(body.error).toContain('supply.declared failed');
  });
});
