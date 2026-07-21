/**
 * Thin kernel API client for AgriFortress.
 *
 * Attaches a short-lived Bearer token (via TokenProvider) to every request.
 * On unexpected 401s it invalidates the cached token and retries once.
 */

import { TokenProvider } from './auth';

const DEFAULT_KERNEL_URL = 'https://imajin.ai';

// ---------------------------------------------------------------------------
// Singleton TokenProvider (one per process)
// ---------------------------------------------------------------------------

function getTokenProvider(): TokenProvider {
  const g = globalThis as typeof globalThis & { __kernelTokenProvider?: TokenProvider };

  if (!g.__kernelTokenProvider) {
    const appDid = process.env.APP_DID;
    const privateKey = process.env.APP_PRIVATE_KEY;
    const attestationId = process.env.APP_ATTESTATION_ID;
    const kernelUrl = process.env.KERNEL_URL ?? DEFAULT_KERNEL_URL;

    if (!appDid || !privateKey || !attestationId) {
      throw new Error(
        'Kernel client requires APP_DID, APP_PRIVATE_KEY, and APP_ATTESTATION_ID env vars',
      );
    }

    g.__kernelTokenProvider = new TokenProvider({ kernelUrl, appDid, privateKey, attestationId });
  }

  return g.__kernelTokenProvider;
}

// ---------------------------------------------------------------------------
// fetchKernel
// ---------------------------------------------------------------------------

/**
 * Fetch a kernel API endpoint with automatic app-auth Bearer injection.
 *
 * @example
 *   const res = await fetchKernel('/api/supply/lots');
 */
export async function fetchKernel(
  path: string,
  options?: RequestInit,
): Promise<Response> {
  const kernelUrl = (process.env.KERNEL_URL ?? DEFAULT_KERNEL_URL).replace(/\/$/, '');
  const provider = getTokenProvider();
  const token = await provider.getToken();
  const url = `${kernelUrl}${path}`;

  const headers = {
    'Content-Type': 'application/json',
    ...options?.headers,
    Authorization: `Bearer ${token}`,
  };

  const res = await fetch(url, { ...options, headers, cache: 'no-store' });

  // On 401, invalidate and retry once
  if (res.status === 401) {
    provider.invalidate();
    const freshToken = await provider.getToken();
    return fetch(url, {
      ...options,
      headers: { ...headers, Authorization: `Bearer ${freshToken}` },
      cache: 'no-store',
    });
  }

  return res;
}
