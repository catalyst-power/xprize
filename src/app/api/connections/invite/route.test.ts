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
  emailSent: true,
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
// Email invite path (xprize#86)
// ---------------------------------------------------------------------------

const EMAIL_INVITE_RESPONSE = {
  invite: { id: 'inv_2', code: 'def456', delivery: 'email' as const, status: 'pending', toDid: 'did:imajin:new-stub' },
  url: 'https://connections.imajin.ai/invite/did:imajin:scott/def456',
  emailSent: true,
};

describe('POST /api/connections/invite — email path (xprize#86)', () => {
  const ORIGINAL_APP_DID = process.env.APP_DID;

  afterEach(() => {
    if (ORIGINAL_APP_DID === undefined) {
      delete process.env.APP_DID;
    } else {
      process.env.APP_DID = ORIGINAL_APP_DID;
    }
  });

  it('returns 400 for a malformed email, without calling the kernel', async () => {
    mockGetSession.mockResolvedValue(SESSION_USER);

    const res = await POST(makeRequest({ toEmail: 'not-an-email' }));

    expect(res.status).toBe(400);
    expect(mockCreateInvite).not.toHaveBeenCalled();
  });

  it('sends delivery: "email" with the trimmed toEmail when a valid address is provided', async () => {
    mockGetSession.mockResolvedValue(SESSION_USER);
    mockCreateInvite.mockResolvedValue(EMAIL_INVITE_RESPONSE);

    await POST(makeRequest({ toEmail: '  david@graceharbour.farm  ' }));

    const [sentBody] = mockCreateInvite.mock.calls[0];
    expect(sentBody).toMatchObject({ delivery: 'email', toEmail: 'david@graceharbour.farm' });
  });

  it('passes pendingAttestationId through unchanged when provided', async () => {
    mockGetSession.mockResolvedValue(SESSION_USER);
    mockCreateInvite.mockResolvedValue(EMAIL_INVITE_RESPONSE);

    await POST(makeRequest({ toEmail: 'david@graceharbour.farm', pendingAttestationId: 'att_pending123' }));

    const [sentBody] = mockCreateInvite.mock.calls[0];
    expect(sentBody.pendingAttestationId).toBe('att_pending123');
  });

  it('omits pendingAttestationId when not provided', async () => {
    mockGetSession.mockResolvedValue(SESSION_USER);
    mockCreateInvite.mockResolvedValue(EMAIL_INVITE_RESPONSE);

    await POST(makeRequest({ toEmail: 'david@graceharbour.farm' }));

    const [sentBody] = mockCreateInvite.mock.calls[0];
    expect(sentBody.pendingAttestationId).toBeUndefined();
  });

  it('resolves scopeDid from APP_DID (the same org-identity source used elsewhere) when configured', async () => {
    process.env.APP_DID = 'did:imajin:agrifortress-org';
    mockGetSession.mockResolvedValue(SESSION_USER);
    mockCreateInvite.mockResolvedValue(EMAIL_INVITE_RESPONSE);

    await POST(makeRequest({ toEmail: 'david@graceharbour.farm' }));

    const [sentBody] = mockCreateInvite.mock.calls[0];
    expect(sentBody.scopeDid).toBe('did:imajin:agrifortress-org');
  });

  it('omits scopeDid when APP_DID is not configured, rather than sending an empty/undefined value', async () => {
    delete process.env.APP_DID;
    mockGetSession.mockResolvedValue(SESSION_USER);
    mockCreateInvite.mockResolvedValue(EMAIL_INVITE_RESPONSE);

    await POST(makeRequest({ toEmail: 'david@graceharbour.farm' }));

    const [sentBody] = mockCreateInvite.mock.calls[0];
    expect(sentBody.scopeDid).toBeUndefined();
  });

  it('never accepts a client-supplied scopeDid — only APP_DID is trusted', async () => {
    process.env.APP_DID = 'did:imajin:agrifortress-org';
    mockGetSession.mockResolvedValue(SESSION_USER);
    mockCreateInvite.mockResolvedValue(EMAIL_INVITE_RESPONSE);

    await POST(makeRequest({ toEmail: 'david@graceharbour.farm', scopeDid: 'did:imajin:attacker-supplied' }));

    const [sentBody] = mockCreateInvite.mock.calls[0];
    expect(sentBody.scopeDid).toBe('did:imajin:agrifortress-org');
  });

  it('returns the kernel response verbatim, including toDid, without adding any "already exists" signal', async () => {
    mockGetSession.mockResolvedValue(SESSION_USER);
    mockCreateInvite.mockResolvedValue(EMAIL_INVITE_RESPONSE);

    const res = await POST(makeRequest({ toEmail: 'david@graceharbour.farm' }));

    expect(res.status).toBe(201);
    const body = await res.json() as typeof EMAIL_INVITE_RESPONSE;
    expect(body).toEqual(EMAIL_INVITE_RESPONSE);
    expect(Object.keys(body)).not.toContain('alreadyExists');
  });

  it('behaves identically for a response representing a brand-new stub vs. a silently-accrued repeat email (no-disclosure invariant)', async () => {
    mockGetSession.mockResolvedValue(SESSION_USER);
    mockCreateInvite.mockResolvedValue(EMAIL_INVITE_RESPONSE);
    const firstRes = await POST(makeRequest({ toEmail: 'brand-new@graceharbour.farm' }));
    const firstBody = await firstRes.json() as typeof EMAIL_INVITE_RESPONSE;

    mockCreateInvite.mockResolvedValue({ ...EMAIL_INVITE_RESPONSE, invite: { ...EMAIL_INVITE_RESPONSE.invite, id: 'inv_3', code: 'ghi789' } });
    const secondRes = await POST(makeRequest({ toEmail: 'repeat@graceharbour.farm' }));
    const secondBody = await secondRes.json() as typeof EMAIL_INVITE_RESPONSE;

    expect(Object.keys(firstBody.invite).sort()).toEqual(Object.keys(secondBody.invite).sort());
    expect(firstRes.status).toBe(secondRes.status);
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
