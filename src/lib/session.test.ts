import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createSessionToken,
  verifySessionToken,
  getSession,
  sessionCookieOptions,
  clearCookieOptions,
  type SessionUser,
} from './session';

// Mock next/headers so getSession can be tested outside a real request context
vi.mock('next/headers', () => ({
  cookies: vi.fn(),
}));

import { cookies } from 'next/headers';

const TEST_SECRET = 'test-secret-must-be-at-least-32-chars!!';
const TEST_USER: SessionUser = {
  did: 'did:imajin:scott',
  displayName: 'Scott',
  handle: 'scott',
  attestationId: 'att-abc-123',
};

beforeEach(() => {
  process.env.SESSION_SECRET = TEST_SECRET;
});

// ---------------------------------------------------------------------------
// createSessionToken
// ---------------------------------------------------------------------------

describe('createSessionToken', () => {
  it('returns a three-part JWT string', async () => {
    const token = await createSessionToken(TEST_USER);
    expect(token.split('.')).toHaveLength(3);
  });

  it('encodes the user payload in the token', async () => {
    const token = await createSessionToken(TEST_USER);
    const payloadB64 = token.split('.')[1];
    const payload = JSON.parse(
      Buffer.from(payloadB64.replaceAll('-', '+').replaceAll('_', '/'), 'base64').toString('utf-8'),
    ) as { user: SessionUser };
    expect(payload.user.did).toBe(TEST_USER.did);
    expect(payload.user.attestationId).toBe(TEST_USER.attestationId);
  });

  it('throws when SESSION_SECRET is not set', async () => {
    delete process.env.SESSION_SECRET;
    await expect(createSessionToken(TEST_USER)).rejects.toThrow('SESSION_SECRET');
  });
});

// ---------------------------------------------------------------------------
// verifySessionToken
// ---------------------------------------------------------------------------

describe('verifySessionToken', () => {
  it('returns the user from a valid token', async () => {
    const token = await createSessionToken(TEST_USER);
    const user = await verifySessionToken(token);
    expect(user?.did).toBe(TEST_USER.did);
    expect(user?.handle).toBe(TEST_USER.handle);
    expect(user?.attestationId).toBe(TEST_USER.attestationId);
  });

  it('returns null for a malformed token', async () => {
    const user = await verifySessionToken('not.a.jwt');
    expect(user).toBeNull();
  });

  it('returns null for a token signed with a different secret', async () => {
    const token = await createSessionToken(TEST_USER);
    process.env.SESSION_SECRET = 'a-completely-different-secret-here!!';
    const user = await verifySessionToken(token);
    expect(user).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// getSession
// ---------------------------------------------------------------------------

describe('getSession', () => {
  it('returns null when the session cookie is absent', async () => {
    vi.mocked(cookies).mockResolvedValue({
      get: vi.fn().mockReturnValue(undefined),
    } as never);

    const user = await getSession();
    expect(user).toBeNull();
  });

  it('returns the user when the session cookie holds a valid token', async () => {
    const token = await createSessionToken(TEST_USER);

    vi.mocked(cookies).mockResolvedValue({
      get: vi.fn().mockReturnValue({ value: token }),
    } as never);

    const user = await getSession();
    expect(user?.did).toBe(TEST_USER.did);
    expect(user?.attestationId).toBe(TEST_USER.attestationId);
  });

  it('returns null when the cookie holds an invalid token', async () => {
    vi.mocked(cookies).mockResolvedValue({
      get: vi.fn().mockReturnValue({ value: 'bad.token.here' }),
    } as never);

    const user = await getSession();
    expect(user).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Cookie option factories
// ---------------------------------------------------------------------------

describe('sessionCookieOptions', () => {
  it('sets httpOnly, sameSite lax, and a positive maxAge', () => {
    const opts = sessionCookieOptions('my-token');
    expect(opts.httpOnly).toBe(true);
    expect(opts.sameSite).toBe('lax');
    expect(opts.maxAge).toBeGreaterThan(0);
    expect(opts.value).toBe('my-token');
    expect(opts.name).toBe('imajin_session');
  });
});

describe('clearCookieOptions', () => {
  it('sets maxAge to 0 and an empty value to expire the cookie', () => {
    const opts = clearCookieOptions();
    expect(opts.maxAge).toBe(0);
    expect(opts.value).toBe('');
    expect(opts.httpOnly).toBe(true);
    expect(opts.name).toBe('imajin_session');
  });
});
