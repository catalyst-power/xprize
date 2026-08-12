import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('./client', () => ({ fetchKernel: vi.fn() }));

import { getAttestationsBySubject, isReceiptBilateral, countersignAttestation } from './attestations';
import { fetchKernel } from './client';

const mockFetchKernel = vi.mocked(fetchKernel);
const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.unstubAllEnvs();
  vi.resetAllMocks();
});

function okResponse(body: unknown) {
  return Promise.resolve({
    ok: true,
    status: 200,
    statusText: 'OK',
    json: () => Promise.resolve(body),
  } as Response);
}

function errorResponse(status: number, body: unknown) {
  return Promise.resolve({
    ok: false,
    status,
    statusText: 'Error',
    json: () => Promise.resolve(body),
  } as Response);
}

describe('getAttestationsBySubject', () => {
  it('GETs /auth/api/attestations with subject_did and optional filters, unauthenticated', async () => {
    const mockFetch = vi.fn().mockReturnValue(okResponse([]));
    globalThis.fetch = mockFetch as unknown as typeof fetch;

    await getAttestationsBySubject({
      subjectDid: 'did:imajin:scott',
      type: 'supply.received',
      status: 'bilateral',
      issuerDid: 'did:imajin:scott',
      limit: 5,
    });

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toContain('/auth/api/attestations');
    expect(url).toContain('subject_did=did%3Aimajin%3Ascott');
    expect(url).toContain('type=supply.received');
    expect(url).toContain('status=bilateral');
    expect(url).toContain('issuer_did=did%3Aimajin%3Ascott');
    expect(url).toContain('limit=5');
    expect((opts as RequestInit)?.method).toBe('GET');
    // No Authorization header — this kernel route is unauthenticated.
    expect((opts as RequestInit)?.headers).toBeUndefined();
  });

  it('returns the parsed AttestationRecord[] on success', async () => {
    const records = [
      {
        id: 'att_1',
        issuerDid: 'did:imajin:scott',
        subjectDid: 'did:imajin:scott',
        type: 'supply.received',
        contextId: 'lot_1',
        contextType: 'supply',
        cid: 'bafy1',
        attestationStatus: 'bilateral',
        issuedAt: '2026-01-01T00:00:00Z',
      },
    ];
    globalThis.fetch = vi.fn().mockReturnValue(okResponse(records)) as unknown as typeof fetch;

    const result = await getAttestationsBySubject({ subjectDid: 'did:imajin:scott' });
    expect(result).toEqual(records);
  });

  it('throws with status + error message on a kernel error response', async () => {
    globalThis.fetch = vi.fn().mockReturnValue(errorResponse(500, { error: 'boom' })) as unknown as typeof fetch;

    await expect(getAttestationsBySubject({ subjectDid: 'did:imajin:scott' })).rejects.toThrow(
      'attestations.read failed: 500',
    );
  });
});

describe('isReceiptBilateral', () => {
  it('returns true when a bilateral supply.received attestation matches the correlationId', async () => {
    globalThis.fetch = vi.fn().mockReturnValue(
      okResponse([
        {
          id: 'att_1',
          issuerDid: 'did:imajin:scott',
          subjectDid: 'did:imajin:scott',
          type: 'supply.received',
          contextId: 'lot_1',
          contextType: 'supply',
          cid: 'bafy1',
          attestationStatus: 'bilateral',
          issuedAt: '2026-01-01T00:00:00Z',
        },
      ]),
    ) as unknown as typeof fetch;

    await expect(isReceiptBilateral('did:imajin:scott', 'lot_1')).resolves.toBe(true);
  });

  it('returns false when no attestation matches the correlationId (different lot)', async () => {
    globalThis.fetch = vi.fn().mockReturnValue(
      okResponse([
        {
          id: 'att_1',
          issuerDid: 'did:imajin:scott',
          subjectDid: 'did:imajin:scott',
          type: 'supply.received',
          contextId: 'lot_other',
          contextType: 'supply',
          cid: 'bafy1',
          attestationStatus: 'bilateral',
          issuedAt: '2026-01-01T00:00:00Z',
        },
      ]),
    ) as unknown as typeof fetch;

    await expect(isReceiptBilateral('did:imajin:scott', 'lot_1')).resolves.toBe(false);
  });

  it('returns false when the kernel query already filters by status=bilateral and returns none', async () => {
    globalThis.fetch = vi.fn().mockReturnValue(okResponse([])) as unknown as typeof fetch;

    await expect(isReceiptBilateral('did:imajin:scott', 'lot_1')).resolves.toBe(false);
  });
});

describe('countersignAttestation', () => {
  it('POSTs attestationId + witnessJws to /auth/api/attestations/countersign via fetchKernel', async () => {
    mockFetchKernel.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: () => Promise.resolve({ id: 'att_1', cid: 'bafy1', status: 'bilateral' }),
    } as Response);

    await countersignAttestation('att_1', 'jws-token', 'att-acting-123');

    expect(mockFetchKernel).toHaveBeenCalledOnce();
    const [path, options, attestationId] = mockFetchKernel.mock.calls[0];
    expect(path).toBe('/auth/api/attestations/countersign');
    expect((options as RequestInit)?.method).toBe('POST');
    expect(JSON.parse((options as RequestInit)?.body as string)).toEqual({
      attestationId: 'att_1',
      witnessJws: 'jws-token',
    });
    expect(attestationId).toBe('att-acting-123');
  });

  it('returns the parsed CountersignResult on success', async () => {
    const result = { id: 'att_1', cid: 'bafy1', status: 'bilateral' as const };
    mockFetchKernel.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: () => Promise.resolve(result),
    } as Response);

    await expect(countersignAttestation('att_1', 'jws-token', 'att-acting-123')).resolves.toEqual(result);
  });

  it('throws with status + error message on a kernel error response', async () => {
    mockFetchKernel.mockResolvedValue({
      ok: false,
      status: 403,
      statusText: 'Forbidden',
      json: () => Promise.resolve({ error: 'Only the attestation subject can countersign' }),
    } as Response);

    await expect(countersignAttestation('att_1', 'jws-token', 'att-acting-123')).rejects.toThrow(
      'attestations.countersign failed: 403 Only the attestation subject can countersign',
    );
  });
});
