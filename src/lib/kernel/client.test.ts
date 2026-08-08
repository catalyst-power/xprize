import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Fake TokenProvider — avoids real Ed25519 signing, network mints, and the
// auto-refresh setInterval (already covered by kernel/auth.test.ts). Records
// which attestationId each instance was constructed with so tests can assert
// fetchKernel / fetchKernelAsOrg select the correct identity.
// ---------------------------------------------------------------------------

interface FakeProviderOpts {
  kernelUrl: string;
  appDid: string;
  privateKey: string;
  attestationId: string;
}

vi.mock('./auth', () => {
  class FakeTokenProvider {
    readonly opts: FakeProviderOpts;
    constructor(opts: FakeProviderOpts) {
      this.opts = opts;
    }
    async getToken(): Promise<string> {
      return `token-for-${this.opts.attestationId}`;
    }
    invalidate(): void {
      // no-op — no caching to invalidate in the fake
    }
    dispose(): void {
      // no-op — nothing scheduled in the fake
    }
  }
  return { TokenProvider: FakeTokenProvider };
});

const ENV_KEYS = [
  'KERNEL_URL',
  'APP_DID',
  'APP_PRIVATE_KEY',
  'APP_ATTESTATION_ID',
  'APP_ORG_ATTESTATION_ID',
] as const;

const ORIGINAL_ENV: Record<string, string | undefined> = {};

function clearCachedTokenProviders(): void {
  const g = globalThis as typeof globalThis & {
    __kernelTokenProvidersByAttestation?: unknown;
    __kernelOrgTokenProvider?: unknown;
  };
  delete g.__kernelTokenProvidersByAttestation;
  delete g.__kernelOrgTokenProvider;
}

beforeEach(() => {
  for (const key of ENV_KEYS) {
    ORIGINAL_ENV[key] = process.env[key];
  }
  process.env.KERNEL_URL = 'https://test.imajin.ai';
  process.env.APP_DID = 'did:imajin:testapp';
  process.env.APP_PRIVATE_KEY = 'a'.repeat(64);
  process.env.APP_ATTESTATION_ID = 'att-user-123';
  process.env.APP_ORG_ATTESTATION_ID = 'att-org-456';
  clearCachedTokenProviders();
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (ORIGINAL_ENV[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = ORIGINAL_ENV[key];
    }
  }
  clearCachedTokenProviders();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.resetModules();
});

function stubDataFetch() {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: () => Promise.resolve({}),
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

// ---------------------------------------------------------------------------
// fetchKernel
// ---------------------------------------------------------------------------

describe('fetchKernel', () => {
  it("mints via the caller-supplied attestationId and attaches a Bearer token — never process.env.APP_ATTESTATION_ID", async () => {
    const fetchMock = stubDataFetch();
    const { fetchKernel } = await import('./client');

    await fetchKernel('/supply/api/lots', undefined, 'att-scott-456');

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, opts] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://test.imajin.ai/supply/api/lots');
    expect((opts.headers as Record<string, string>).Authorization).toBe(
      'Bearer token-for-att-scott-456',
    );
  });

  it('caches a separate TokenProvider per distinct attestationId', async () => {
    const fetchMock = stubDataFetch();
    const { fetchKernel } = await import('./client');

    await fetchKernel('/supply/api/lots', undefined, 'att-scott');
    await fetchKernel('/supply/api/lots', undefined, 'att-dave');

    const [, scottOpts] = fetchMock.mock.calls[0] as [string, RequestInit];
    const [, daveOpts] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect((scottOpts.headers as Record<string, string>).Authorization).toBe(
      'Bearer token-for-att-scott',
    );
    expect((daveOpts.headers as Record<string, string>).Authorization).toBe(
      'Bearer token-for-att-dave',
    );
  });

  it('throws a descriptive error when APP_DID / APP_PRIVATE_KEY env vars are missing', async () => {
    delete process.env.APP_DID;
    const { fetchKernel } = await import('./client');

    await expect(fetchKernel('/supply/api/lots', undefined, 'att-scott-456')).rejects.toThrow(
      'APP_DID and APP_PRIVATE_KEY',
    );
  });
});

// ---------------------------------------------------------------------------
// fetchKernelAsOrg
// ---------------------------------------------------------------------------

describe('fetchKernelAsOrg', () => {
  it('mints via the org-level attestation and attaches a Bearer token', async () => {
    const fetchMock = stubDataFetch();
    const { fetchKernelAsOrg } = await import('./client');

    await fetchKernelAsOrg('/connections/api/connectors/status');

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, opts] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://test.imajin.ai/connections/api/connectors/status');
    expect((opts.headers as Record<string, string>).Authorization).toBe(
      'Bearer token-for-att-org-456',
    );
  });

  it('throws a descriptive error when APP_ORG_ATTESTATION_ID is missing', async () => {
    delete process.env.APP_ORG_ATTESTATION_ID;
    const { fetchKernelAsOrg } = await import('./client');

    await expect(fetchKernelAsOrg('/connections/api/connectors/status')).rejects.toThrow(
      'APP_DID, APP_PRIVATE_KEY, and APP_ORG_ATTESTATION_ID',
    );
  });

  it('does not require APP_ORG_ATTESTATION_ID for plain fetchKernel calls', async () => {
    delete process.env.APP_ORG_ATTESTATION_ID;
    stubDataFetch();
    const { fetchKernel } = await import('./client');

    await expect(
      fetchKernel('/supply/api/lots', undefined, 'att-scott-456'),
    ).resolves.toBeDefined();
  });
});
