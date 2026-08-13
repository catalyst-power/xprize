/**
 * Thin kernel API client for AgriFortress.
 *
 * Attaches a short-lived Bearer token (via TokenProvider) to every request.
 * On unexpected 401s it invalidates the cached token and retries once.
 *
 * Two acting identities are supported:
 *   - fetchKernel     — a specific supplier's own consent attestation, passed
 *                       in explicitly by the caller (pulled from that user's
 *                       session — see src/lib/session.ts). This app is
 *                       multi-user, so there is no single "the" supplier
 *                       attestation baked into env vars.
 *   - fetchKernelAsSelf — the app's own identity (APP_DID + APP_PRIVATE_KEY),
 *                       no consent attestation at all. Used when AgriFortress
 *                       is checking a fact about *itself* (e.g. its own
 *                       org-level connector configuration for Gemini) rather
 *                       than acting on behalf of a supplier — there is no
 *                       human to obtain consent from, so no attestation
 *                       concept applies.
 */

import { TokenProvider } from './auth';

const DEFAULT_KERNEL_URL = 'https://imajin.ai';

// ---------------------------------------------------------------------------
// TokenProviders — cached per attestation ID (one per acting supplier, plus
// one for the app's own self-authenticated identity), since this app serves
// many suppliers concurrently from the same process.
// ---------------------------------------------------------------------------

function getTokenProvider(attestationId: string, baseUrlOverride?: string): TokenProvider {
  const appDid = process.env.APP_DID;
  const privateKey = process.env.APP_PRIVATE_KEY;
  const kernelUrl = baseUrlOverride ?? process.env.KERNEL_URL ?? DEFAULT_KERNEL_URL;

  if (!appDid || !privateKey) {
    throw new Error('Kernel client requires APP_DID and APP_PRIVATE_KEY env vars');
  }

  const g = globalThis as typeof globalThis & {
    __kernelTokenProvidersByAttestation?: Map<string, TokenProvider>;
  };
  g.__kernelTokenProvidersByAttestation ??= new Map();

  // Keyed by base URL + attestationId so an explicit `baseUrlOverride`
  // (e.g. AGRIFORTRESS_SUPPLY_API_URL, see fetchKernelAtUrl below) never
  // collides with the default KERNEL_URL provider for the same attestation.
  const cacheKey = `${kernelUrl}::${attestationId}`;
  let provider = g.__kernelTokenProvidersByAttestation.get(cacheKey);
  if (!provider) {
    provider = new TokenProvider({ kernelUrl, appDid, privateKey, attestationId });
    g.__kernelTokenProvidersByAttestation.set(cacheKey, provider);
  }

  return provider;
}

function getSelfTokenProvider(): TokenProvider {
  const g = globalThis as typeof globalThis & { __kernelSelfTokenProvider?: TokenProvider };

  if (!g.__kernelSelfTokenProvider) {
    const appDid = process.env.APP_DID;
    const privateKey = process.env.APP_PRIVATE_KEY;
    const kernelUrl = process.env.KERNEL_URL ?? DEFAULT_KERNEL_URL;

    if (!appDid || !privateKey) {
      throw new Error('Kernel client requires APP_DID and APP_PRIVATE_KEY env vars');
    }

    // No attestationId — the app authenticates as itself, not on behalf of
    // any supplier.
    g.__kernelSelfTokenProvider = new TokenProvider({ kernelUrl, appDid, privateKey });
  }

  return g.__kernelSelfTokenProvider;
}

// ---------------------------------------------------------------------------
// fetchKernel / fetchKernelAsSelf
// ---------------------------------------------------------------------------

async function fetchWithProvider(
  provider: TokenProvider,
  path: string,
  options?: RequestInit,
  baseUrlOverride?: string,
): Promise<Response> {
  const kernelUrl = (baseUrlOverride ?? process.env.KERNEL_URL ?? DEFAULT_KERNEL_URL).replace(/\/$/, '');
  const token = await provider.getToken();
  const url = `${kernelUrl}${path}`;

  // Skip Content-Type for multipart (FormData) so fetch auto-sets the boundary.
  const isFormData = typeof FormData !== 'undefined' && options?.body instanceof FormData;
  const baseHeaders: Record<string, string> = isFormData
    ? {}
    : { 'Content-Type': 'application/json' };

  // Dual-guard kernel routes (resolveEffectiveDid) only enter the app-auth
  // branch when this header is present — without it, the bearer app token
  // is mistaken for a kernel web session and 401s (see xprize#71). Omit the
  // header entirely rather than sending the literal string 'undefined' if
  // APP_DID isn't configured.
  const appDid = process.env.APP_DID;
  const appDidHeaders: Record<string, string> = appDid ? { 'X-App-DID': appDid } : {};

  const headers = {
    ...baseHeaders,
    ...options?.headers,
    ...appDidHeaders,
    Authorization: `Bearer ${token}`,
  };

  const res = await fetch(url, { ...options, headers, cache: 'no-store' });

  // On 401, invalidate and retry once
  if (res.status === 401) {
    provider.invalidate();
    const freshToken = await provider.getToken();
    return fetch(url, {
      ...options,
      headers: { ...headers, ...appDidHeaders, Authorization: `Bearer ${freshToken}` },
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
 * Fetch a kernel API endpoint acting as the app's own identity — APP_DID +
 * APP_PRIVATE_KEY only, no consent attestation and no `onBehalfOf`. Use this
 * when AgriFortress is checking a fact about itself, e.g. its own org-level
 * connector configuration (Gemini's org-subsidized key), rather than acting
 * on behalf of a specific supplier.
 *
 * @example
 *   const res = await fetchKernelAsSelf('/connections/api/connectors/status');
 */
export async function fetchKernelAsSelf(
  path: string,
  options?: RequestInit,
): Promise<Response> {
  return fetchWithProvider(getSelfTokenProvider(), path, options);
}

/**
 * Fetch a kernel API endpoint with automatic app-auth Bearer injection,
 * acting on behalf of a specific supplier, against an explicit base URL
 * rather than the default `KERNEL_URL`.
 *
 * Used by the inference→supply bridge (xprize#88): lot materialization is
 * gated on its own `AGRIFORTRESS_SUPPLY_API_URL` env var — mirroring the
 * kernel vocabulary resolver's own feature flag — rather than on the
 * always-configured `KERNEL_URL`, so materialization stays an explicit
 * per-environment opt-in. See `materializeInferenceSupplyLot` in
 * src/lib/supply.ts for the call site.
 *
 * @example
 *   const res = await fetchKernelAtUrl(supplyApiUrl, '/supply/api/received', opts, attestationId);
 */
export async function fetchKernelAtUrl(
  baseUrl: string,
  path: string,
  options: RequestInit | undefined,
  attestationId: string,
): Promise<Response> {
  return fetchWithProvider(getTokenProvider(attestationId, baseUrl), path, options, baseUrl);
}
