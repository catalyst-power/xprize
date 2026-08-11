import { describe, it, expect, vi, afterEach } from 'vitest';
import { createConnectionInvite, getConnections, connectionLabel, type ConnectionEntry } from './identity';

vi.mock('./client', () => ({ fetchKernel: vi.fn() }));

import { fetchKernel } from './client';

const mockFetchKernel = vi.mocked(fetchKernel);

afterEach(() => {
  vi.resetAllMocks();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function okResponse(body: object) {
  return Promise.resolve({
    ok: true,
    status: 200,
    statusText: 'OK',
    json: () => Promise.resolve(body),
  } as Response);
}

function errorResponse(status: number, statusText: string) {
  return Promise.resolve({ ok: false, status, statusText } as Response);
}

const CONNECTIONS: ConnectionEntry[] = [
  { did: 'did:imajin:grace', handle: 'graceharbour', name: 'Grace Harbour Farms', nickname: null, connectedAt: '2026-01-01T00:00:00Z' },
  { did: 'did:imajin:david', handle: 'david', name: 'David Ko', nickname: 'Dave', connectedAt: '2026-01-02T00:00:00Z' },
];

// ---------------------------------------------------------------------------
// getConnections
// ---------------------------------------------------------------------------

describe('getConnections', () => {
  it('GETs /connections/api/connections via fetchKernel, passing the caller-supplied attestationId', async () => {
    mockFetchKernel.mockReturnValue(okResponse({ connections: CONNECTIONS }));

    await getConnections('att-scott-123');

    expect(mockFetchKernel).toHaveBeenCalledOnce();
    const [path, opts, attestationId] = mockFetchKernel.mock.calls[0];
    expect(path).toBe('/connections/api/connections');
    expect(opts?.method).toBe('GET');
    expect(attestationId).toBe('att-scott-123');
  });

  it('returns the parsed connections list on success', async () => {
    mockFetchKernel.mockReturnValue(okResponse({ connections: CONNECTIONS }));

    const result = await getConnections('att-scott-123');

    expect(result).toEqual(CONNECTIONS);
  });

  it('returns an empty array when the kernel has no connections for this DID', async () => {
    mockFetchKernel.mockReturnValue(okResponse({ connections: [] }));

    const result = await getConnections('att-scott-123');

    expect(result).toEqual([]);
  });

  it('throws with status + statusText on a kernel error response', async () => {
    mockFetchKernel.mockReturnValue(errorResponse(403, 'Forbidden'));

    await expect(getConnections('att-scott-123')).rejects.toThrow(
      'identity.connections failed: 403',
    );
  });
});

// ---------------------------------------------------------------------------
// connectionLabel
// ---------------------------------------------------------------------------

describe('connectionLabel', () => {
  it('prefers the nickname when present', () => {
    expect(connectionLabel(CONNECTIONS[1])).toBe('Dave');
  });

  it('falls back to name when there is no nickname', () => {
    expect(connectionLabel(CONNECTIONS[0])).toBe('Grace Harbour Farms');
  });

  it('falls back to handle when there is no nickname or name', () => {
    const conn: ConnectionEntry = { did: 'did:imajin:x', handle: 'xfarm', name: null, nickname: null, connectedAt: '2026-01-01T00:00:00Z' };
    expect(connectionLabel(conn)).toBe('xfarm');
  });

  it('falls back to the raw DID as a last resort', () => {
    const conn: ConnectionEntry = { did: 'did:imajin:x', handle: null, name: null, nickname: null, connectedAt: '2026-01-01T00:00:00Z' };
    expect(connectionLabel(conn)).toBe('did:imajin:x');
  });
});

// ---------------------------------------------------------------------------
// createConnectionInvite (xprize#59)
// ---------------------------------------------------------------------------

const INVITE_RESPONSE = {
  invite: { id: 'inv_1', code: 'abc123', delivery: 'link' as const, status: 'pending' },
  url: 'https://connections.imajin.ai/invite/did:imajin:scott/abc123',
};

describe('createConnectionInvite', () => {
  it('POSTs to /connections/api/invites via fetchKernel, passing the caller-supplied attestationId', async () => {
    mockFetchKernel.mockReturnValue(okResponse(INVITE_RESPONSE));

    await createConnectionInvite({ delivery: 'link', note: 'AgriFortress delivery pending' }, 'att-scott-123');

    expect(mockFetchKernel).toHaveBeenCalledOnce();
    const [path, opts, attestationId] = mockFetchKernel.mock.calls[0];
    expect(path).toBe('/connections/api/invites');
    expect(opts?.method).toBe('POST');
    expect(attestationId).toBe('att-scott-123');
  });

  it('sends the request body as JSON', async () => {
    mockFetchKernel.mockReturnValue(okResponse(INVITE_RESPONSE));

    await createConnectionInvite({ delivery: 'link', note: 'note text' }, 'att-scott-123');

    const [, opts] = mockFetchKernel.mock.calls[0];
    expect(JSON.parse(opts?.body as string)).toEqual({ delivery: 'link', note: 'note text' });
  });

  it('returns the parsed CreateInviteResponse on success', async () => {
    mockFetchKernel.mockReturnValue(okResponse(INVITE_RESPONSE));

    const result = await createConnectionInvite({ delivery: 'link' }, 'att-scott-123');

    expect(result.url).toBe(INVITE_RESPONSE.url);
    expect(result.invite.code).toBe('abc123');
  });

  it('throws with status + error message on a kernel error response', async () => {
    mockFetchKernel.mockReturnValue(
      Promise.resolve({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        json: () => Promise.resolve({ error: 'Not authenticated' }),
      } as Response),
    );

    await expect(createConnectionInvite({ delivery: 'link' }, 'att-scott-123')).rejects.toThrow(
      'identity.invites.create failed: 401',
    );
  });
});
