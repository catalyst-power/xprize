import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from './route';

vi.mock('@/lib/session', () => ({ getSession: vi.fn() }));
vi.mock('@/lib/kernel/auth', () => ({ buildAppWitnessJws: vi.fn() }));
vi.mock('@/lib/kernel/attestations', () => ({ countersignAttestation: vi.fn() }));

import { getSession } from '@/lib/session';
import { buildAppWitnessJws } from '@/lib/kernel/auth';
import { countersignAttestation } from '@/lib/kernel/attestations';

const mockGetSession = vi.mocked(getSession);
const mockBuildWitnessJws = vi.mocked(buildAppWitnessJws);
const mockCountersign = vi.mocked(countersignAttestation);

const SESSION_USER = {
  did: 'did:imajin:debbie',
  displayName: 'Debbie',
  handle: 'debbie',
  attestationId: 'att-debbie-1',
};

const COUNTERSIGN_RESULT = { id: 'att_1', cid: 'bafy1', status: 'bilateral' as const };

function makeRequest() {
  return new NextRequest('http://localhost/api/attestations/att_1/sign', { method: 'POST' });
}

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

beforeEach(() => {
  vi.stubEnv('APP_DID', 'did:imajin:agrifortress');
  vi.stubEnv('APP_PRIVATE_KEY', 'a'.repeat(64));
});

afterEach(() => {
  vi.resetAllMocks();
  vi.unstubAllEnvs();
});

// ---------------------------------------------------------------------------
// Auth guard
// ---------------------------------------------------------------------------

describe('POST /api/attestations/[id]/sign — auth', () => {
  it('returns 401 when there is no session', async () => {
    mockGetSession.mockResolvedValue(null);

    const res = await POST(makeRequest(), makeParams('att_1'));

    expect(res.status).toBe(401);
    expect(mockCountersign).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// App identity guard
// ---------------------------------------------------------------------------

describe('POST /api/attestations/[id]/sign — app identity guard', () => {
  it('returns 500 when APP_DID/APP_PRIVATE_KEY are not configured', async () => {
    vi.unstubAllEnvs();
    mockGetSession.mockResolvedValue(SESSION_USER);

    const res = await POST(makeRequest(), makeParams('att_1'));

    expect(res.status).toBe(500);
    expect(mockCountersign).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Happy path
// ---------------------------------------------------------------------------

describe('POST /api/attestations/[id]/sign — success', () => {
  it('returns 200 with the kernel countersign result', async () => {
    mockGetSession.mockResolvedValue(SESSION_USER);
    mockBuildWitnessJws.mockResolvedValue('jws-token');
    mockCountersign.mockResolvedValue(COUNTERSIGN_RESULT);

    const res = await POST(makeRequest(), makeParams('att_1'));

    expect(res.status).toBe(200);
    const body = await res.json() as typeof COUNTERSIGN_RESULT;
    expect(body).toEqual(COUNTERSIGN_RESULT);
  });

  it('builds the witnessJws with the attestationId from route params and the session user as subject', async () => {
    mockGetSession.mockResolvedValue(SESSION_USER);
    mockBuildWitnessJws.mockResolvedValue('jws-token');
    mockCountersign.mockResolvedValue(COUNTERSIGN_RESULT);

    await POST(makeRequest(), makeParams('att_xyz'));

    expect(mockBuildWitnessJws).toHaveBeenCalledWith({
      appDid: 'did:imajin:agrifortress',
      privateKey: 'a'.repeat(64),
      attestationId: 'att_xyz',
      subjectDid: SESSION_USER.did,
    });
  });

  it('countersigns acting as the session user (their own consent attestation)', async () => {
    mockGetSession.mockResolvedValue(SESSION_USER);
    mockBuildWitnessJws.mockResolvedValue('jws-token');
    mockCountersign.mockResolvedValue(COUNTERSIGN_RESULT);

    await POST(makeRequest(), makeParams('att_xyz'));

    expect(mockCountersign).toHaveBeenCalledWith('att_xyz', 'jws-token', SESSION_USER.attestationId);
  });
});

// ---------------------------------------------------------------------------
// Kernel failure
// ---------------------------------------------------------------------------

describe('POST /api/attestations/[id]/sign — kernel failure', () => {
  it('returns 502 when countersignAttestation throws', async () => {
    mockGetSession.mockResolvedValue(SESSION_USER);
    mockBuildWitnessJws.mockResolvedValue('jws-token');
    mockCountersign.mockRejectedValue(
      new Error('attestations.countersign failed: 409 Attestation is not in pending state'),
    );

    const res = await POST(makeRequest(), makeParams('att_1'));

    expect(res.status).toBe(502);
    const body = await res.json() as { error: string };
    expect(body.error).toContain('attestations.countersign failed');
  });

  it('logs the failure server-side', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mockGetSession.mockResolvedValue(SESSION_USER);
    mockBuildWitnessJws.mockResolvedValue('jws-token');
    mockCountersign.mockRejectedValue(new Error('boom'));

    await POST(makeRequest(), makeParams('att_1'));

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('[attestations/sign]'),
      expect.stringContaining('boom'),
    );
    consoleErrorSpy.mockRestore();
  });
});
