/**
 * Tests for POST /api/supply/deliver
 *
 * Validates the declared→received two-step flow, partial failure handling,
 * auth gating, and input validation.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('@/lib/session', () => ({
  getSession: vi.fn(),
}));

vi.mock('@/lib/kernel/client', () => ({
  fetchKernel: vi.fn(),
}));

import { getSession } from '@/lib/session';
import { fetchKernel } from '@/lib/kernel/client';
import { POST } from './route';
import { NextRequest } from 'next/server';

const mockGetSession = vi.mocked(getSession);
const mockFetchKernel = vi.mocked(fetchKernel);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost:3000/api/supply/deliver', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const VALID_BODY = { commodity: 'eggs', quantity: 6, unit: 'dozen' };

const SESSION_USER = {
  did: 'did:imajin:testuser123',
  displayName: 'Scott',
  handle: 'scott',
  attestationId: 'att_test123',
};

function kernelResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /api/supply/deliver', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 when no session', async () => {
    mockGetSession.mockResolvedValue(null);
    const res = await POST(makeRequest(VALID_BODY));
    expect(res.status).toBe(401);
    const data = await res.json();
    expect(data.error).toBe('Not authenticated');
  });

  it('returns 400 for missing commodity', async () => {
    mockGetSession.mockResolvedValue(SESSION_USER);
    const res = await POST(makeRequest({ quantity: 6, unit: 'dozen' }));
    expect(res.status).toBe(400);
  });

  it('returns 400 for quantity <= 0', async () => {
    mockGetSession.mockResolvedValue(SESSION_USER);
    const res = await POST(makeRequest({ commodity: 'eggs', quantity: 0, unit: 'dozen' }));
    expect(res.status).toBe(400);
  });

  it('returns 400 for missing unit', async () => {
    mockGetSession.mockResolvedValue(SESSION_USER);
    const res = await POST(makeRequest({ commodity: 'eggs', quantity: 6 }));
    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid JSON', async () => {
    mockGetSession.mockResolvedValue(SESSION_USER);
    const req = new NextRequest('http://localhost:3000/api/supply/deliver', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not json',
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('fires declared→received and returns 201 on success', async () => {
    mockGetSession.mockResolvedValue(SESSION_USER);
    mockFetchKernel
      .mockResolvedValueOnce(
        kernelResponse(201, { ok: true, correlationId: 'lot_abc123', stage: 'declared' }),
      )
      .mockResolvedValueOnce(
        kernelResponse(201, { ok: true, correlationId: 'lot_abc123', stage: 'received' }),
      );

    const res = await POST(makeRequest(VALID_BODY));
    expect(res.status).toBe(201);

    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.correlationId).toBe('lot_abc123');
    expect(data.stage).toBe('received');

    // Verify declared was called first with correct body
    expect(mockFetchKernel).toHaveBeenCalledTimes(2);
    expect(mockFetchKernel).toHaveBeenNthCalledWith(1, '/supply/api/declared', {
      method: 'POST',
      body: JSON.stringify({ commodity: 'eggs', quantity: 6, unit: 'dozen' }),
    });

    // Verify received was called with lotId from declared
    expect(mockFetchKernel).toHaveBeenNthCalledWith(2, '/supply/api/received', {
      method: 'POST',
      body: JSON.stringify({ lotId: 'lot_abc123', commodity: 'eggs', quantity: 6, unit: 'dozen' }),
    });
  });

  it('returns error when declared fails', async () => {
    mockGetSession.mockResolvedValue(SESSION_USER);
    mockFetchKernel.mockResolvedValueOnce(
      kernelResponse(500, { error: 'Internal error' }),
    );

    const res = await POST(makeRequest(VALID_BODY));
    expect(res.status).toBe(500);

    const data = await res.json();
    expect(data.error).toContain('Declared failed');
    // received should NOT have been called
    expect(mockFetchKernel).toHaveBeenCalledTimes(1);
  });

  it('returns partial failure when declared succeeds but received fails', async () => {
    mockGetSession.mockResolvedValue(SESSION_USER);
    mockFetchKernel
      .mockResolvedValueOnce(
        kernelResponse(201, { ok: true, correlationId: 'lot_partial', stage: 'declared' }),
      )
      .mockResolvedValueOnce(
        kernelResponse(400, { error: 'Lot not found' }),
      );

    const res = await POST(makeRequest(VALID_BODY));
    expect(res.status).toBe(400);

    const data = await res.json();
    expect(data.error).toContain('Receipt failed');
    expect(data.partialLotId).toBe('lot_partial');
    expect(data.stage).toBe('declared');
  });
});
