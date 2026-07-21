import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from './route';

// Mock the session module so we don't need SESSION_SECRET or real JWTs here.
// Use a plain function for sessionCookieOptions — vi.fn().mockReturnValue inside
// vi.mock factories doesn't chain reliably across all vitest versions.
vi.mock('@/lib/session', () => ({
  createSessionToken: vi.fn().mockResolvedValue('mock-session-token'),
  sessionCookieOptions: () => ({
    name: 'imajin_session',
    value: 'mock-session-token',
    httpOnly: true,
    sameSite: 'lax' as const,
    maxAge: 604800,
    path: '/',
  }),
}));

const BASE = 'http://localhost:3000';
const KERNEL_URL = 'https://imajin.ai';

function makeReq(search = ''): NextRequest {
  return new NextRequest(`${BASE}/api/auth/callback${search}`);
}

function mockProfileFetch(overrides: Partial<{ ok: boolean; status: number; body: object }> = {}) {
  const { ok = true, status = 200, body = { did: 'did:imajin:scott', displayName: 'Scott', handle: 'scott' } } = overrides;
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  }));
}

beforeEach(() => {
  process.env.KERNEL_URL = KERNEL_URL;
  delete process.env.NEXT_PUBLIC_APP_URL;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('GET /api/auth/callback', () => {
  it('redirects to /?auth_error=missing_params when attestation_id is absent', async () => {
    const res = await GET(makeReq('?user_did=did:imajin:scott'));
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('auth_error=missing_params');
  });

  it('redirects to /?auth_error=missing_params when user_did is absent', async () => {
    const res = await GET(makeReq('?attestation_id=att-123'));
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('auth_error=missing_params');
  });

  it('redirects to /?auth_error=attestation_revoked on a 403 profile response', async () => {
    mockProfileFetch({ ok: false, status: 403 });
    const res = await GET(makeReq('?attestation_id=att-123&user_did=did:imajin:scott'));
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('auth_error=attestation_revoked');
  });

  it('redirects to /?auth_error=profile_fetch_failed on any other non-ok profile response', async () => {
    mockProfileFetch({ ok: false, status: 500 });
    const res = await GET(makeReq('?attestation_id=att-123&user_did=did:imajin:scott'));
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('auth_error=profile_fetch_failed');
  });

  it('redirects to /?auth_error=network_error when fetch throws', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));
    const res = await GET(makeReq('?attestation_id=att-123&user_did=did:imajin:scott'));
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('auth_error=network_error');
  });

  it('fetches the public profile without X-App-DID headers', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ did: 'did:imajin:scott', displayName: 'Scott', handle: 'scott' }),
      text: () => Promise.resolve(''),
    });
    vi.stubGlobal('fetch', fetchSpy);

    await GET(makeReq('?attestation_id=att-123&user_did=did:imajin:scott'));

    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const headers = init?.headers as Record<string, string> | undefined;
    expect(headers?.['X-App-DID']).toBeUndefined();
    expect(headers?.['X-App-Authorization']).toBeUndefined();
  });

  it('redirects to /dashboard and sets the session cookie on success', async () => {
    mockProfileFetch();
    const res = await GET(makeReq('?attestation_id=att-123&user_did=did:imajin:scott'));

    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('/dashboard');
    expect(res.headers.get('set-cookie')).toContain('imajin_session');
  });

  it('resolves a relative avatar URL against KERNEL_URL', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({
        did: 'did:imajin:scott',
        displayName: 'Scott',
        handle: 'scott',
        avatar: '/media/avatars/scott.jpg',
      }),
      text: () => Promise.resolve(''),
    }));

    const { createSessionToken } = await import('@/lib/session');

    await GET(makeReq('?attestation_id=att-123&user_did=did:imajin:scott'));

    const callArg = vi.mocked(createSessionToken).mock.calls.at(-1)?.[0];
    expect(callArg?.avatar).toBe(`${KERNEL_URL}/media/avatars/scott.jpg`);
  });
});
