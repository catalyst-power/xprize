import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/session', () => ({
  getSession: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  redirect: vi.fn(() => {
    throw new Error('NEXT_REDIRECT');
  }),
}));

vi.mock('@/lib/kernel/consent', () => ({
  buildConsentUrl: vi.fn(() => 'https://imajin.example/consent'),
}));

import { getSession } from '@/lib/session';
import { redirect } from 'next/navigation';
import Home from './page';

const mockGetSession = vi.mocked(getSession);
const mockRedirect = vi.mocked(redirect);

const SESSION_USER = {
  did: 'did:imajin:scott',
  displayName: 'Scott',
  handle: 'scott',
  attestationId: 'att-123',
};

// ---------------------------------------------------------------------------
// Home (landing page) — session redirect (from closed #53, xprize#49)
//
// Previously this page always showed "Sign in with Imajin" even when a
// valid session cookie existed. A signed-in visitor should be sent straight
// to the dashboard instead.
// ---------------------------------------------------------------------------

describe('Home', () => {
  it('redirects to /dashboard when a valid session exists', async () => {
    mockGetSession.mockResolvedValue(SESSION_USER);

    await expect(
      Home({ searchParams: Promise.resolve({}) }),
    ).rejects.toThrow('NEXT_REDIRECT');

    expect(mockRedirect).toHaveBeenCalledWith('/dashboard');
  });

  it('renders the sign-in page (does not redirect) when no session exists', async () => {
    mockGetSession.mockResolvedValue(null);

    const element = await Home({ searchParams: Promise.resolve({}) });

    expect(mockRedirect).not.toHaveBeenCalled();
    expect(element).toBeDefined();
  });
});
