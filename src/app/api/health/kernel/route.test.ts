import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/lib/kernel/auth', () => ({
  mintAppToken: vi.fn(),
  resolveAppAuth: vi.fn(),
}));

import { mintAppToken, resolveAppAuth } from '@/lib/kernel/auth';
import { GET } from './route';

const mockMintAppToken = vi.mocked(mintAppToken);
const mockResolveAppAuth = vi.mocked(resolveAppAuth);

const ENV_KEYS = ['APP_DID', 'APP_PRIVATE_KEY', 'APP_ATTESTATION_ID', 'KERNEL_URL'] as const;
const ORIGINAL_ENV: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const key of ENV_KEYS) {
    ORIGINAL_ENV[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (ORIGINAL_ENV[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = ORIGINAL_ENV[key];
    }
  }
  vi.resetAllMocks();
});

describe('GET /api/health/kernel', () => {
  it('returns 503 misconfigured when APP_DID / APP_PRIVATE_KEY are missing, without requiring APP_ATTESTATION_ID', async () => {
    const res = await GET();

    expect(res.status).toBe(503);
    const body = await res.json() as { status: string; error: string };
    expect(body.status).toBe('misconfigured');
    expect(body.error).toBe('APP_DID and APP_PRIVATE_KEY env vars are required');
    expect(body.error).not.toContain('APP_ATTESTATION_ID');
  });

  it('runs a self-authenticated connectivity check when APP_ATTESTATION_ID is not set', async () => {
    process.env.APP_DID = 'did:imajin:testapp';
    process.env.APP_PRIVATE_KEY = 'a'.repeat(64);
    mockMintAppToken.mockResolvedValue({ token: 'tok', expiresIn: 600, scopes: ['supply:read'] });

    const res = await GET();

    expect(res.status).toBe(200);
    expect(mockMintAppToken).toHaveBeenCalledWith(
      expect.objectContaining({ appDid: 'did:imajin:testapp', privateKey: 'a'.repeat(64) }),
    );
    expect(mockResolveAppAuth).not.toHaveBeenCalled();
    const body = await res.json() as { status: string; scopes: string[] };
    expect(body.status).toBe('ok');
    expect(body.scopes).toEqual(['supply:read']);
  });

  it('runs the full handshake and resolves userDid when APP_ATTESTATION_ID is set', async () => {
    process.env.APP_DID = 'did:imajin:testapp';
    process.env.APP_PRIVATE_KEY = 'a'.repeat(64);
    process.env.APP_ATTESTATION_ID = 'att-diagnostic-123';
    mockResolveAppAuth.mockResolvedValue({
      token: 'tok',
      userDid: 'did:imajin:scott',
      scopes: ['supply:read'],
    });

    const res = await GET();

    expect(res.status).toBe(200);
    expect(mockResolveAppAuth).toHaveBeenCalledWith(
      expect.objectContaining({ appDid: 'did:imajin:testapp', attestationId: 'att-diagnostic-123' }),
    );
    expect(mockMintAppToken).not.toHaveBeenCalled();
    const body = await res.json() as { status: string; userDid: string };
    expect(body.status).toBe('ok');
    expect(body.userDid).toBe('did:imajin:scott');
  });

  it('returns 502 when the kernel call fails', async () => {
    process.env.APP_DID = 'did:imajin:testapp';
    process.env.APP_PRIVATE_KEY = 'a'.repeat(64);
    mockMintAppToken.mockRejectedValue(new Error('Token mint failed: 500 Internal Server Error'));

    const res = await GET();

    expect(res.status).toBe(502);
    const body = await res.json() as { status: string; error: string };
    expect(body.status).toBe('error');
    expect(body.error).toContain('Token mint failed');
  });
});
