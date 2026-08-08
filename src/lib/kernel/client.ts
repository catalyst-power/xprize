/**
 * Thin kernel API client for AgriFortress.
 *
 * Attaches a short-lived Bearer token (via TokenProvider) to every request.
 * On unexpected 401s it invalidates the cached token and retries once.
 *
 * Two acting identities are supported, matching whose consent attestation
 * mints the token:
 *   - fetchKernel      — the app's per-supplier attestation (APP_ATTESTATION_ID)
 *   - fetchKernelAsOrg — the app's own org-level attestation (APP_ORG_ATTESTATION_ID),
 *                        used for org-subsidized connectors (e.g. Gemini) that an
 *                        org admin configures once on the app's own Imajin profile
 *                        rather than per supplier.
 */

import { TokenProvider } from './auth';

const DEFAULT_KERNEL_URL = 'https://imajin.ai';

// ---------------------------------------------------------------------------
// Singleton TokenProviders (one per process)
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

function getOrgTokenProvider(): TokenProvider {
  const g = globalThis as typeof globalThis & { __kernelOrgTokenProvider?: TokenProvider };

  if (!g.__kernelOrgTokenProvider) {
    const appDid = process.env.APP_DID;
    const privateKey = process.env.APP_PRIVATE_KEY;
    const attestationId = process.env.APP_ORG_ATTESTATION_ID;
    const kernelUrl = process.env.KERNEL_URL ?? DEFAULT_KERNEL_URL;

    if (!appDid || !privateKey || !attestationId) {
      throw new Error(
        'Org-level kernel client requires APP_DID, APP_PRIVATE_KEY, and APP_ORG_ATTESTATION_ID env vars',
      );
    }

    g.__kernelOrgTokenProvider = new TokenProvider({ kernelUrl, appDid, privateKey, attestationId });
  }

  return g.__kernelOrgTokenProvider;
}

// ---------------------------------------------------------------------------
// fetchKernel / fetchKernelAsOrg
// ---------------------------------------------------------------------------

async function fetchWithProvider(
  provider: TokenProvider,
  path: string,
  options?: RequestInit,
): Promise<Response> {
  const kernelUrl = (process.env.KERNEL_URL ?? DEFAULT_KERNEL_URL).replace(/\/$/, '');
  const token = await provider.getToken();
  const url = `${kernelUrl}${path}`;

  // Skip Content-Type for multipart (FormData) so fetch auto-sets the boundary.
  const isFormData = typeof FormData !== 'undefined' && options?.body instanceof FormData;
  const baseHeaders: Record<string, string> = isFormData
    ? {}
    : { 'Content-Type': 'application/json' };

  const headers = {
    ...baseHeaders,
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

/**
 * Fetch a kernel API endpoint with automatic app-auth Bearer injection,
 * acting on behalf of the app's configured supplier (APP_ATTESTATION_ID).
 *
 * @example
 *   const res = await fetchKernel('/api/supply/lots');
 */
export async function fetchKernel(
  path: string,
  options?: RequestInit,
): Promise<Response> {
  return fetchWithProvider(getTokenProvider(), path, options);
}

/**
 * Fetch a kernel API endpoint acting as the app's own org-level identity
 * (APP_ORG_ATTESTATION_ID), for connectors an org admin configures once for
 * every supplier who uses this app (e.g. Gemini's org-subsidized key).
 *
 * @example
 *   const res = await fetchKernelAsOrg('/connections/api/connectors/status');
 */
export async function fetchKernelAsOrg(
  path: string,
  options?: RequestInit,
): Promise<Response> {
  return fetchWithProvider(getOrgTokenProvider(), path, options);
}
