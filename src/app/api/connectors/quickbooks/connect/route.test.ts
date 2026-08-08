import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/session', () => ({
  getSession: vi.fn(),
}));

vi.mock('@/lib/kernel/client', () => ({
  fetchKernel: vi.fn(),
}));

import { getSession } from '@/lib/session';
import { fetchKernel } from '@/lib/kernel/client';
import { GET } from './route';

const mockGetSession = vi.mocked(getSession);
const mockFetchKernel = vi.mocked(fetchKernel);

const SESSION_USER = {
  did: 'did:imajin:scott',
  displayName: 'Scott',
  handle: 'scott',
  attestationId: 'att-123',
};

function makeReq(): NextRequest {
  return new NextRequest('http://localhost:3000/api/connectors/quickbooks/connect');
}

function kernelResponse(overrides: Partial<{ status: number; location: string | null; ok: boolean; body: unknown }> = {}) {
  const { status = 302, location = null, ok = status < 400, body = {} } = overrides;
  const headers = new Headers();
  if (location) headers.set('location', location);
  return {
    ok,
    status,
    statusText: 'status',
    headers,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

beforeEach(() => {
  delete process.env.NEXT_PUBLIC_APP_URL;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('GET /api/connectors/quickbooks/connect', () => {
  it('redirects to / when there is no active session', async () => {
    mockGetSession.mockResolvedValue(null);

    const res = await GET(makeReq());

    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toMatch(/\/$/);
    expect(mockFetchKernel).not.toHaveBeenCalled();
  });

  it('calls the kernel with app-auth, onBehalfOf the user, and a returnTo back to the dashboard', async () => {
    mockGetSession.mockResolvedValue(SESSION_USER);
    mockFetchKernel.mockResolvedValue(kernelResponse({ location: 'https://intuit.example/oauth' }));
    process.env.NEXT_PUBLIC_APP_URL = 'https://integrity.imajin.ai';

    await GET(makeReq());

    expect(mockFetchKernel).toHaveBeenCalledOnce();
    const [path, opts] = mockFetchKernel.mock.calls[0];
    const url = new URL(path, 'https://kernel.example');
    expect(url.pathname).toBe('/quickbooks/api/connect');
    expect(url.searchParams.get('onBehalfOf')).toBe('did:imajin:scott');
    expect(url.searchParams.get('returnTo')).toBe('https://integrity.imajin.ai/dashboard');
    expect(opts?.redirect).toBe('manual');
  });

  it('forwards the kernel redirect (to Intuit) to the browser', async () => {
    mockGetSession.mockResolvedValue(SESSION_USER);
    mockFetchKernel.mockResolvedValue(kernelResponse({ location: 'https://intuit.example/oauth?state=abc' }));

    const res = await GET(makeReq());

    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe('https://intuit.example/oauth?state=abc');
  });

  it('forwards a redirectUrl from a 200 JSON body when no Location header is present', async () => {
    mockGetSession.mockResolvedValue(SESSION_USER);
    mockFetchKernel.mockResolvedValue(
      kernelResponse({ status: 200, body: { redirectUrl: 'https://intuit.example/oauth' } }),
    );

    const res = await GET(makeReq());

    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe('https://intuit.example/oauth');
  });

  it('redirects to the dashboard with an error flag when the kernel gives neither a Location nor a redirectUrl', async () => {
    mockGetSession.mockResolvedValue(SESSION_USER);
    mockFetchKernel.mockResolvedValue(kernelResponse({ status: 200, body: {} }));

    const res = await GET(makeReq());

    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('/dashboard');
    expect(res.headers.get('location')).toContain('connect_error=quickbooks');
  });

  it('redirects to the dashboard with an error flag on a kernel error status', async () => {
    mockGetSession.mockResolvedValue(SESSION_USER);
    mockFetchKernel.mockResolvedValue(kernelResponse({ status: 500, ok: false }));

    const res = await GET(makeReq());

    expect(res.headers.get('location')).toContain('connect_error=quickbooks');
  });

  it('redirects to the dashboard with an error flag when the kernel request throws', async () => {
    mockGetSession.mockResolvedValue(SESSION_USER);
    mockFetchKernel.mockRejectedValue(new Error('ECONNREFUSED'));

    const res = await GET(makeReq());

    expect(res.headers.get('location')).toContain('connect_error=quickbooks');
  });

  it('never sends kernel connector credentials or tokens in the response it forwards', async () => {
    mockGetSession.mockResolvedValue(SESSION_USER);
    mockFetchKernel.mockResolvedValue(kernelResponse({ location: 'https://intuit.example/oauth' }));

    const res = await GET(makeReq());

    // The route only ever relays a redirect URL — never a token/credential body.
    expect(res.headers.get('set-cookie')).toBeNull();
  });
});
