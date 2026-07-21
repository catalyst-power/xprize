import { describe, it, expect, vi } from 'vitest';
import { GET } from './route';

vi.mock('@/lib/session', () => ({ getSession: vi.fn() }));

import { getSession } from '@/lib/session';

describe('GET /api/auth/session', () => {
  it('returns 401 when there is no active session', async () => {
    vi.mocked(getSession).mockResolvedValue(null);
    const res = await GET();
    expect(res.status).toBe(401);
    const body = await res.json() as { error: string };
    expect(body.error).toBeTruthy();
  });

  it('returns 200 with the session user when a session exists', async () => {
    const user = { did: 'did:imajin:scott', displayName: 'Scott', handle: 'scott', attestationId: 'att-1' };
    vi.mocked(getSession).mockResolvedValue(user);
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ did: user.did, handle: user.handle });
  });
});
