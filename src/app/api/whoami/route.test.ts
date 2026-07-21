import { describe, it, expect, vi } from 'vitest';
import { GET } from './route';

vi.mock('@/lib/session', () => ({ getSession: vi.fn() }));

import { getSession } from '@/lib/session';

describe('GET /api/whoami', () => {
  it('returns 401 when there is no session', async () => {
    vi.mocked(getSession).mockResolvedValue(null);
    const res = await GET();
    expect(res.status).toBe(401);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('Unauthorized');
  });

  it('returns 200 with the full session user object', async () => {
    const user = { did: 'did:imajin:scott', displayName: 'Scott', handle: 'scott', attestationId: 'att-1' };
    vi.mocked(getSession).mockResolvedValue(user);
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json() as typeof user;
    expect(body.did).toBe(user.did);
    expect(body.displayName).toBe(user.displayName);
    expect(body.attestationId).toBe(user.attestationId);
  });
});
