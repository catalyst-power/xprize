/**
 * Consent URL builder for AgriFortress.
 *
 * Constructs the URL that sends a user to the Imajin kernel consent screen
 * (keypair-app lane). After the user approves, the kernel redirects to the
 * app's registered callbackUrl with ?attestation_id=...&user_did=...
 *
 * Kernel consent screen: {kernelUrl}/auth/authorize?app_id={APP_ID}&scopes={...}
 * Reference: ima-jin/imajin-ai apps/kernel/app/auth/authorize/page.tsx
 */

const DEFAULT_KERNEL_URL = 'https://imajin.ai';

/**
 * Scopes AgriFortress requests from the Imajin kernel.
 *
 * supply:read/write   — delivery lots, stages, signed receipts
 * profile:read        — show Scott's name/handle in the app
 * media:read/write    — delivery photos
 * quickbooks:read     — read QuickBooks invoice as the settlement signal
 *                       (Scott fires the invoice himself; app only reads it)
 */
export const AGRIFORTRESS_SCOPES = [
  'supply:read',
  'supply:write',
  'profile:read',
  'media:read',
  'media:write',
  'quickbooks:read',
] as const;

export interface ConsentUrlOptions {
  /** Imajin kernel base URL. Defaults to https://imajin.ai */
  kernelUrl?: string;
  /** Registry app ID (app_xxx) — distinct from appDid. Obtained at registration. */
  appId: string;
  /** Scopes to request. Defaults to AGRIFORTRESS_SCOPES. */
  scopes?: string[];
}

/**
 * Build the consent URL that sends a user to the Imajin kernel authorization screen.
 *
 * @example
 *   buildConsentUrl({ appId: 'app_abc123' })
 *   // → "https://imajin.ai/auth/authorize?app_id=app_abc123&scopes=supply%3Aread%2Csupply%3Awrite"
 */
export function buildConsentUrl(opts: ConsentUrlOptions): string {
  const kernelUrl = (opts.kernelUrl ?? DEFAULT_KERNEL_URL).replace(/\/$/, '');
  const scopes = opts.scopes ?? [...AGRIFORTRESS_SCOPES];

  const url = new URL(`${kernelUrl}/auth/authorize`);
  url.searchParams.set('app_id', opts.appId);
  if (scopes.length > 0) {
    url.searchParams.set('scopes', scopes.join(','));
  }
  return url.toString();
}
