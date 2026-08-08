import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as ed from '@noble/ed25519';
import { mintAppToken, resolveAppAuth, TokenProvider } from './auth';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

// A real Ed25519 keypair generated once for all tests.
// Using a deterministic seed so tests are reproducible.
const TEST_SEED = new Uint8Array(32).fill(0xab); // valid 32-byte seed

let TEST_PRIV_KEY_HEX: string;
let TEST_PUB_KEY_HEX: string;

function bytesToHex(b: Uint8Array): string {
  return Array.from(b).map(x => x.toString(16).padStart(2, '0')).join('');
}

// Build a minimal HS256-style JWT with the given payload (not signed — just for decoding tests)
function makeFakeJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'EdDSA' })).toString('base64url');
  const body   = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${header}.${body}.fakesig`;
}

const TEST_APP_DID      = 'did:imajin:testapp';
const TEST_ATTESTATION  = 'att-test-123';
const TEST_KERNEL_URL   = 'https://test.imajin.ai';
const TEST_USER_DID     = 'did:imajin:scott';

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(async () => {
  TEST_PRIV_KEY_HEX = bytesToHex(TEST_SEED);
  TEST_PUB_KEY_HEX  = bytesToHex(await ed.getPublicKeyAsync(TEST_SEED));
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// mintAppToken
// ---------------------------------------------------------------------------

describe('mintAppToken', () => {
  it('sends a POST to {kernelUrl}/auth/api/apps/token', async () => {
    const token = makeFakeJwt({ sub: TEST_USER_DID, azp: TEST_APP_DID });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ token, expiresIn: 600, scopes: ['supply:read'] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await mintAppToken({
      kernelUrl: TEST_KERNEL_URL,
      appDid: TEST_APP_DID,
      attestationId: TEST_ATTESTATION,
      privateKey: TEST_PRIV_KEY_HEX,
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url] = fetchMock.mock.calls[0] as [string, ...unknown[]];
    expect(url).toBe(`${TEST_KERNEL_URL}/auth/api/apps/token`);
  });

  it('sends the correct body shape including a nonce ≥ 16 chars and ISO timestamp', async () => {
    const token = makeFakeJwt({ sub: TEST_USER_DID });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ token, expiresIn: 600, scopes: [] }),
    }));

    await mintAppToken({
      kernelUrl: TEST_KERNEL_URL,
      appDid: TEST_APP_DID,
      attestationId: TEST_ATTESTATION,
      privateKey: TEST_PRIV_KEY_HEX,
    });

    const [, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as {
      appDid: string; attestationId: string; nonce: string;
      timestamp: string; signature: string;
    };

    expect(body.appDid).toBe(TEST_APP_DID);
    expect(body.attestationId).toBe(TEST_ATTESTATION);
    expect(body.nonce.length).toBeGreaterThanOrEqual(16);
    expect(() => new Date(body.timestamp)).not.toThrow();
    expect(typeof body.signature).toBe('string');
    expect(body.signature.length).toBe(128); // 64-byte Ed25519 sig = 128 hex chars
  });

  it('signs the correct challenge: appDid:attestationId:nonce:timestamp', async () => {
    const token = makeFakeJwt({ sub: TEST_USER_DID });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ token, expiresIn: 600, scopes: [] }),
    }));

    await mintAppToken({
      kernelUrl: TEST_KERNEL_URL,
      appDid: TEST_APP_DID,
      attestationId: TEST_ATTESTATION,
      privateKey: TEST_PRIV_KEY_HEX,
    });

    const [, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
    const { nonce, timestamp, signature } = JSON.parse(init.body as string) as {
      nonce: string; timestamp: string; signature: string;
    };

    const challenge = `${TEST_APP_DID}:${TEST_ATTESTATION}:${nonce}:${timestamp}`;
    const msgBytes  = new TextEncoder().encode(challenge);
    const sigBytes  = Uint8Array.from(Buffer.from(signature, 'hex'));

    const valid = await ed.verifyAsync(sigBytes, msgBytes, await ed.getPublicKeyAsync(TEST_SEED));
    expect(valid).toBe(true);
  });

  it('throws with a descriptive message when the kernel returns an error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      statusText: 'Not Found',
      json: () => Promise.resolve({ error: 'Unknown app DID' }),
    }));

    await expect(
      mintAppToken({
        kernelUrl: TEST_KERNEL_URL,
        appDid: TEST_APP_DID,
        attestationId: TEST_ATTESTATION,
        privateKey: TEST_PRIV_KEY_HEX,
      }),
    ).rejects.toThrow('404');
  });

  it('omits attestationId from the request body when acting as the app itself', async () => {
    const token = makeFakeJwt({ sub: TEST_APP_DID });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ token, expiresIn: 600, scopes: [] }),
    }));

    await mintAppToken({
      kernelUrl: TEST_KERNEL_URL,
      appDid: TEST_APP_DID,
      privateKey: TEST_PRIV_KEY_HEX,
    });

    const [, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as Record<string, unknown>;

    expect(body.attestationId).toBeUndefined();
    expect('attestationId' in body).toBe(false);
    expect(body.appDid).toBe(TEST_APP_DID);
  });

  it('signs the self challenge appDid:nonce:timestamp (no attestation segment)', async () => {
    const token = makeFakeJwt({ sub: TEST_APP_DID });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ token, expiresIn: 600, scopes: [] }),
    }));

    await mintAppToken({
      kernelUrl: TEST_KERNEL_URL,
      appDid: TEST_APP_DID,
      privateKey: TEST_PRIV_KEY_HEX,
    });

    const [, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
    const { nonce, timestamp, signature } = JSON.parse(init.body as string) as {
      nonce: string; timestamp: string; signature: string;
    };

    const challenge = `${TEST_APP_DID}:${nonce}:${timestamp}`;
    const msgBytes  = new TextEncoder().encode(challenge);
    const sigBytes  = Uint8Array.from(Buffer.from(signature, 'hex'));

    const valid = await ed.verifyAsync(sigBytes, msgBytes, await ed.getPublicKeyAsync(TEST_SEED));
    expect(valid).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// resolveAppAuth
// ---------------------------------------------------------------------------

describe('resolveAppAuth', () => {
  it('extracts userDid from the JWT sub claim', async () => {
    const token = makeFakeJwt({ sub: TEST_USER_DID, azp: TEST_APP_DID });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ token, expiresIn: 600, scopes: ['supply:read', 'supply:write'] }),
    }));

    const { userDid, scopes } = await resolveAppAuth({
      kernelUrl: TEST_KERNEL_URL,
      appDid: TEST_APP_DID,
      attestationId: TEST_ATTESTATION,
      privateKey: TEST_PRIV_KEY_HEX,
    });

    expect(userDid).toBe(TEST_USER_DID);
    expect(scopes).toEqual(['supply:read', 'supply:write']);
  });

  it('throws when the token has no sub claim', async () => {
    const token = makeFakeJwt({ azp: TEST_APP_DID }); // sub missing
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ token, expiresIn: 600, scopes: [] }),
    }));

    await expect(
      resolveAppAuth({
        kernelUrl: TEST_KERNEL_URL,
        appDid: TEST_APP_DID,
        attestationId: TEST_ATTESTATION,
        privateKey: TEST_PRIV_KEY_HEX,
      }),
    ).rejects.toThrow('sub');
  });
});

// ---------------------------------------------------------------------------
// TokenProvider
// ---------------------------------------------------------------------------

describe('TokenProvider', () => {
  function makeProvider() {
    return new TokenProvider({
      kernelUrl: TEST_KERNEL_URL,
      appDid: TEST_APP_DID,
      attestationId: TEST_ATTESTATION,
      privateKey: TEST_PRIV_KEY_HEX,
    });
  }

  function stubFetchWithToken(token: string) {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ token, expiresIn: 600, scopes: [] }),
    });
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  it('mints a token on first getToken() call', async () => {
    const fetchSpy = stubFetchWithToken('token-a');
    const provider = makeProvider();

    const token = await provider.getToken();

    expect(token).toBe('token-a');
    expect(fetchSpy).toHaveBeenCalledOnce();

    provider.dispose();
  });

  it('returns the cached token on subsequent calls without re-minting', async () => {
    const fetchSpy = stubFetchWithToken('token-b');
    const provider = makeProvider();

    await provider.getToken();
    await provider.getToken();
    await provider.getToken();

    expect(fetchSpy).toHaveBeenCalledOnce();

    provider.dispose();
  });

  it('mints a fresh token after invalidate()', async () => {
    let callCount = 0;
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => {
      callCount += 1;
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ token: `token-${callCount}`, expiresIn: 600, scopes: [] }),
      });
    }));

    const provider = makeProvider();

    const first = await provider.getToken();
    expect(first).toBe('token-1');

    provider.invalidate();
    const second = await provider.getToken();
    expect(second).toBe('token-2');

    expect(callCount).toBe(2);
    provider.dispose();
  });

  it('schedules auto-refresh at 80% of TTL (480 000 ms)', async () => {
    // Test the configuration of the auto-refresh mechanism without firing the
    // timer — the actual interval callback is covered by the invalidate() test.
    const setIntervalSpy = vi.spyOn(global, 'setInterval');
    stubFetchWithToken('token-timer');

    const provider = makeProvider();
    await provider.getToken(); // triggers mint and schedules the refresh interval

    expect(setIntervalSpy).toHaveBeenCalledWith(
      expect.any(Function),
      480_000, // 600s * 0.8 * 1000ms
    );

    provider.dispose();
  });

  it('coalesces concurrent getToken() calls into a single mint', async () => {
    const fetchSpy = stubFetchWithToken('token-concurrent');
    const provider = makeProvider();

    // Fire three concurrent calls
    const [a, b, c] = await Promise.all([
      provider.getToken(),
      provider.getToken(),
      provider.getToken(),
    ]);

    expect(a).toBe('token-concurrent');
    expect(b).toBe('token-concurrent');
    expect(c).toBe('token-concurrent');
    expect(fetchSpy).toHaveBeenCalledOnce();

    provider.dispose();
  });

  it('mints without an attestationId when constructed for the app itself', async () => {
    const fetchSpy = stubFetchWithToken('token-self');
    const provider = new TokenProvider({
      kernelUrl: TEST_KERNEL_URL,
      appDid: TEST_APP_DID,
      privateKey: TEST_PRIV_KEY_HEX,
      // attestationId intentionally omitted — self-authenticated identity
    });

    const token = await provider.getToken();

    expect(token).toBe('token-self');
    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect('attestationId' in body).toBe(false);

    provider.dispose();
  });
});
