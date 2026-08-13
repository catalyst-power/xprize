import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Fake TokenProvider — avoids real Ed25519 signing, network mints, and the
// auto-refresh setInterval (already covered by kernel/auth.test.ts). Records
// which attestationId each instance was constructed with (or none, for the
// app's own self-authenticated identity) so tests can assert fetchKernel /
// fetchKernelAsSelf select the correct identity.
// ---------------------------------------------------------------------------

interface FakeProviderOpts {
  kernelUrl: string;
  appDid: string;
  privateKey: string;
  attestationId?: string;
}

vi.mock('./auth', () => {
  class FakeTokenProvider {
    readonly opts: FakeProviderOpts;
    constructor(opts: FakeProviderOpts) {
      this.opts = opts;
    }
    async getToken(): Promise<string> {
      return this.opts.attestationId
        ? `token-for-${this.opts.attestationId}`
        : 'token-for-self';
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
] as const;

const ORIGINAL_ENV: Record<string, string | undefined> = {};

function clearCachedTokenProviders(): void {
  const g = globalThis as typeof globalThis & {
    __kernelTokenProvidersByAttestation?: unknown;
    __kernelSelfTokenProvider?: unknown;
  };
  delete g.__kernelTokenProvidersByAttestation;
  delete g.__kernelSelfTokenProvider;
}

beforeEach(() => {
  for (const key of ENV_KEYS) {
    ORIGINAL_ENV[key] = process.env[key];
  }
  process.env.KERNEL_URL = 'https://test.imajin.ai';
  process.env.APP_DID = 'did:imajin:testapp';
  process.env.APP_PRIVATE_KEY = 'a'.repeat(64);
  process.env.APP_ATTESTATION_ID = 'att-user-123';
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
    expect((opts.headers as Record<string, string>)['X-App-DID']).toBe('did:imajin:testapp');
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

  it('attaches X-App-DID on the 401-retry request too, so dual-guard kernel routes do not reject the retry', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 401, json: () => Promise.resolve({}) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve({}) });
    vi.stubGlobal('fetch', fetchMock);
    const { fetchKernel } = await import('./client');

    await fetchKernel('/supply/api/lots', undefined, 'att-scott-456');

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [, retryOpts] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect((retryOpts.headers as Record<string, string>)['X-App-DID']).toBe('did:imajin:testapp');
    expect((retryOpts.headers as Record<string, string>).Authorization).toBe(
      'Bearer token-for-att-scott-456',
    );
  });
});

// ---------------------------------------------------------------------------
// fetchKernelAtUrl (xprize#88 — inference→supply bridge)
// ---------------------------------------------------------------------------

describe('fetchKernelAtUrl', () => {
  it('targets the explicit base URL instead of KERNEL_URL', async () => {
    const fetchMock = stubDataFetch();
    const { fetchKernelAtUrl } = await import('./client');

    await fetchKernelAtUrl(
      'https://dev-jin.imajin.ai',
      '/supply/api/received',
      { method: 'POST', body: '{}' },
      'att-scott-456',
    );

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, opts] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://dev-jin.imajin.ai/supply/api/received');
    expect((opts.headers as Record<string, string>).Authorization).toBe(
      'Bearer token-for-att-scott-456',
    );
    expect((opts.headers as Record<string, string>)['X-App-DID']).toBe('did:imajin:testapp');
  });

  it('does not affect KERNEL_URL-based fetchKernel calls for the same attestationId', async () => {
    const fetchMock = stubDataFetch();
    const { fetchKernel, fetchKernelAtUrl } = await import('./client');

    await fetchKernelAtUrl('https://dev-jin.imajin.ai', '/supply/api/received', undefined, 'att-scott');
    await fetchKernel('/supply/api/lots', undefined, 'att-scott');

    const [overrideUrl] = fetchMock.mock.calls[0] as [string, RequestInit];
    const [defaultUrl] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(overrideUrl).toBe('https://dev-jin.imajin.ai/supply/api/received');
    expect(defaultUrl).toBe('https://test.imajin.ai/supply/api/lots');
  });
});

// ---------------------------------------------------------------------------
// fetchKernelAsSelf
// ---------------------------------------------------------------------------

describe('fetchKernelAsSelf', () => {
  it('mints with no attestationId and attaches a Bearer token for the app itself', async () => {
    const fetchMock = stubDataFetch();
    const { fetchKernelAsSelf } = await import('./client');

    await fetchKernelAsSelf('/connections/api/connectors/status');

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, opts] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://test.imajin.ai/connections/api/connectors/status');
    expect((opts.headers as Record<string, string>).Authorization).toBe(
      'Bearer token-for-self',
    );
    expect((opts.headers as Record<string, string>)['X-App-DID']).toBe('did:imajin:testapp');
  });

  it('throws a descriptive error when APP_DID / APP_PRIVATE_KEY env vars are missing', async () => {
    delete process.env.APP_DID;
    const { fetchKernelAsSelf } = await import('./client');

    await expect(fetchKernelAsSelf('/connections/api/connectors/status')).rejects.toThrow(
      'APP_DID and APP_PRIVATE_KEY',
    );
  });

  it('caches a single self token provider across calls (no per-attestation caching)', async () => {
    const fetchMock = stubDataFetch();
    const { fetchKernelAsSelf } = await import('./client');

    await fetchKernelAsSelf('/connections/api/connectors/status');
    await fetchKernelAsSelf('/connections/api/connectors/status');

    const [, firstOpts] = fetchMock.mock.calls[0] as [string, RequestInit];
    const [, secondOpts] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect((firstOpts.headers as Record<string, string>).Authorization).toBe('Bearer token-for-self');
    expect((secondOpts.headers as Record<string, string>).Authorization).toBe('Bearer token-for-self');
  });

  it('attaches X-App-DID on the 401-retry request too', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 401, json: () => Promise.resolve({}) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve({}) });
    vi.stubGlobal('fetch', fetchMock);
    const { fetchKernelAsSelf } = await import('./client');

    await fetchKernelAsSelf('/connections/api/connectors/status');

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [, retryOpts] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect((retryOpts.headers as Record<string, string>)['X-App-DID']).toBe('did:imajin:testapp');
    expect((retryOpts.headers as Record<string, string>).Authorization).toBe('Bearer token-for-self');
  });
});
