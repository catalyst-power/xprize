/**
 * Thin kernel API client for AgriFortress.
 *
 * Attaches a short-lived Bearer token (via TokenProvider) to every request.
 * On unexpected 401s it invalidates the cached token and retries once.
 *
 * Two acting identities are supported, matching whose consent attestation
 * mints the token:
 *   - fetchKernel      — a specific supplier's own consent attestation, passed
 *                        in explicitly by the caller (pulled from that user's
 *                        session — see src/lib/session.ts). This app is
 *                        multi-user, so there is no single "the" supplier
 *                        attestation baked into env vars.
 *   - fetchKernelAsOrg — the app's own org-level attestation (APP_ORG_ATTESTATION_ID),
 *                        used for org-subsidized connectors (e.g. Gemini) that an
 *                        org admin configures once on the app's own Imajin profile
 *                        rather than per supplier.
 */

import { TokenProvider } from './auth';

const DEFAULT_KERNEL_URL = 'https://imajin.ai';

// ---------------------------------------------------------------------------
// TokenProviders — cached per attestation ID (one per acting supplier, plus
// one for the org-level identity), since this app serves many suppliers
// concurrently from the same process.
// ---------------------------------------------------------------------------

function getTokenProvider(attestationId: string): TokenProvider {
  const appDid = process.env.APP_DID;
  const privateKey = process.env.APP_PRIVATE_KEY;
  const kernelUrl = process.env.KERNEL_URL ?? DEFAULT_KERNEL_URL;

  if (!appDid || !privateKey) {
    throw new Error('Kernel client requires APP_DID and APP_PRIVATE_KEY env vars');
  }

  const g = globalThis as typeof globalThis & {
    __kernelTokenProvidersByAttestation?: Map<string, TokenProvider>;
  };
  g.__kernelTokenProvidersByAttestation ??= new Map();

  let provider = g.__kernelTokenProvidersByAttestation.get(attestationId);
  if (!provider) {
    provider = new TokenProvider({ kernelUrl, appDid, privateKey, attestationId });
    g.__kernelTokenProvidersByAttestation.set(attestationId, provider);
  }

  return provider;
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
 * acting on behalf of a specific supplier.
 *
 * `attestationId` must be the acting user's own consent attestation ID
 * (`SessionUser.attestationId` from `getSession()`) — never a value read
 * from process.env. This app is multi-user, so there is no single "the"
 * supplier attestation to bake into env vars; each request must carry the
 * attestation of whichever supplier is actually logged in.
 *
 * @example
 *   const user = await getSession();
 *   const res = await fetchKernel('/api/supply/lots', undefined, user.attestationId);
 */
export async function fetchKernel(
  path: string,
  options: RequestInit | undefined,
  attestationId: string,
): Promise<Response> {
  return fetchWithProvider(getTokenProvider(attestationId), path, options);
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
