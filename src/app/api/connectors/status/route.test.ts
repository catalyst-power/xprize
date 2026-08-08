import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('@/lib/session', () => ({ getSession: vi.fn() }));
vi.mock('@/lib/kernel/connectors', () => ({ getUserConnectorStatus: vi.fn() }));

import { getSession } from '@/lib/session';
import { getUserConnectorStatus } from '@/lib/kernel/connectors';
import { GET } from './route';

const mockGetSession = vi.mocked(getSession);
const mockGetUserConnectorStatus = vi.mocked(getUserConnectorStatus);

const SESSION_USER = {
  did: 'did:imajin:scott',
  displayName: 'Scott',
  handle: 'scott',
  attestationId: 'att-scott-123',
};

const STATUSES = [
  { id: 'quickbooks', connected: true, scopes: ['quickbooks:read', 'quickbooks:write'] },
];

afterEach(() => {
  vi.resetAllMocks();
});

describe('GET /api/connectors/status', () => {
  it('returns 401 when there is no active session', async () => {
    mockGetSession.mockResolvedValue(null);

    const res = await GET();

    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('Unauthorized');
    expect(mockGetUserConnectorStatus).not.toHaveBeenCalled();
  });

  it("resolves the acting user's own session attestation, never a shared env value", async () => {
    mockGetSession.mockResolvedValue(SESSION_USER);
    mockGetUserConnectorStatus.mockResolvedValue(STATUSES);

    await GET();

    expect(mockGetUserConnectorStatus).toHaveBeenCalledOnce();
    expect(mockGetUserConnectorStatus).toHaveBeenCalledWith(SESSION_USER.attestationId);
  });

  it('returns 200 with the live connector statuses on success', async () => {
    mockGetSession.mockResolvedValue(SESSION_USER);
    mockGetUserConnectorStatus.mockResolvedValue(STATUSES);

    const res = await GET();

    expect(res.status).toBe(200);
    const body = (await res.json()) as typeof STATUSES;
    expect(body).toEqual(STATUSES);
  });

  it('returns 502 when the kernel call fails', async () => {
    mockGetSession.mockResolvedValue(SESSION_USER);
    mockGetUserConnectorStatus.mockRejectedValue(
      new Error('connectors.status failed: 500 Internal Server Error'),
    );

    const res = await GET();

    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('connectors.status failed');
  });
});
