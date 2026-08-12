import { describe, it, expect, vi, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from './route';

vi.mock('@/lib/session', () => ({ getSession: vi.fn() }));
vi.mock('@/lib/kernel/identity', () => ({ createConnectionInvite: vi.fn() }));

import { getSession } from '@/lib/session';
import { createConnectionInvite } from '@/lib/kernel/identity';

const mockGetSession = vi.mocked(getSession);
const mockCreateInvite = vi.mocked(createConnectionInvite);

afterEach(() => {
  vi.resetAllMocks();
});

const SESSION_USER = {
  did: 'did:imajin:scott',
  displayName: 'Scott',
  handle: 'scott',
  attestationId: 'att-1',
};

const INVITE_RESPONSE = {
  invite: { id: 'inv_1', code: 'abc123', delivery: 'link' as const, status: 'pending' },
  url: 'https://connections.imajin.ai/invite/did:imajin:scott/abc123',
};

function makeRequest(body?: object) {
  return new NextRequest('http://localhost/api/connections/invite', {
    method: 'POST',
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

// ---------------------------------------------------------------------------
// Auth guard
// ---------------------------------------------------------------------------

describe('POST /api/connections/invite — auth', () => {
  it('returns 401 when there is no session', async () => {
    mockGetSession.mockResolvedValue(null);

    const res = await POST(makeRequest());

    expect(res.status).toBe(401);
    expect(mockCreateInvite).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Happy path
// ---------------------------------------------------------------------------

describe('POST /api/connections/invite — success', () => {
  it('returns 201 with the kernel invite response', async () => {
    mockGetSession.mockResolvedValue(SESSION_USER);
    mockCreateInvite.mockResolvedValue(INVITE_RESPONSE);

    const res = await POST(makeRequest({ recipientLabel: 'David Ko' }));

    expect(res.status).toBe(201);
    const body = await res.json() as typeof INVITE_RESPONSE;
    expect(body.url).toBe(INVITE_RESPONSE.url);
  });

  it('creates a link-delivery invite, passing the session attestationId', async () => {
    mockGetSession.mockResolvedValue(SESSION_USER);
    mockCreateInvite.mockResolvedValue(INVITE_RESPONSE);

    await POST(makeRequest({ recipientLabel: 'David Ko' }));

    expect(mockCreateInvite).toHaveBeenCalledWith(
      expect.objectContaining({ delivery: 'link' }),
      SESSION_USER.attestationId,
    );
  });

  it("includes the recipientLabel in the invite's note when provided", async () => {
    mockGetSession.mockResolvedValue(SESSION_USER);
    mockCreateInvite.mockResolvedValue(INVITE_RESPONSE);

    await POST(makeRequest({ recipientLabel: 'David Ko' }));

    const [sentBody] = mockCreateInvite.mock.calls[0];
    expect(sentBody.note).toContain('David Ko');
  });

  it('uses a generic note when no recipientLabel is provided', async () => {
    mockGetSession.mockResolvedValue(SESSION_USER);
    mockCreateInvite.mockResolvedValue(INVITE_RESPONSE);

    await POST(makeRequest({}));

    const [sentBody] = mockCreateInvite.mock.calls[0];
    expect(sentBody.note).toBeDefined();
  });

  it('does not fail when the request has no body at all', async () => {
    mockGetSession.mockResolvedValue(SESSION_USER);
    mockCreateInvite.mockResolvedValue(INVITE_RESPONSE);

    const res = await POST(makeRequest());

    expect(res.status).toBe(201);
  });
});

// ---------------------------------------------------------------------------
// Kernel failure
// ---------------------------------------------------------------------------

describe('POST /api/connections/invite — kernel failure', () => {
  it('returns 502 when createConnectionInvite throws (honest error, never a false "invite sent" claim)', async () => {
    mockGetSession.mockResolvedValue(SESSION_USER);
    mockCreateInvite.mockRejectedValue(
      new Error('identity.invites.create failed: 401 Not authenticated'),
    );

    const res = await POST(makeRequest({}));

    expect(res.status).toBe(502);
    const body = await res.json() as { error: string };
    expect(body.error).toContain('identity.invites.create failed');
  });

  it('logs the failure server-side instead of swallowing it (xprize#77)', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockGetSession.mockResolvedValue(SESSION_USER);
    mockCreateInvite.mockRejectedValue(
      new Error('identity.invites.create failed: 401 Not authenticated'),
    );

    await POST(makeRequest({}));

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('[connections/invite]'),
      expect.stringContaining('identity.invites.create failed'),
    );
    consoleErrorSpy.mockRestore();
  });
});
