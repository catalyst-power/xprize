import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from './route';

vi.mock('@/lib/session', () => ({
  clearCookieOptions: vi.fn().mockReturnValue({
    name: 'imajin_session',
    value: '',
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 0,
    path: '/',
  }),
}));

beforeEach(() => {
  delete process.env.NEXT_PUBLIC_APP_URL;
});

describe('GET /api/auth/logout', () => {
  it('redirects to /', async () => {
    const req = new NextRequest('http://localhost:3000/api/auth/logout');
    const res = await GET(req);
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toMatch(/\/$/);
  });

  it('clears the session cookie', async () => {
    const req = new NextRequest('http://localhost:3000/api/auth/logout');
    const res = await GET(req);
    const cookie = res.headers.get('set-cookie') ?? '';
    expect(cookie).toContain('imajin_session');
    expect(cookie).toContain('Max-Age=0');
  });
});
