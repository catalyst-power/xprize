/**
 * Kernel app-auth client for AgriFortress.
 *
 * Implements the preferred short-lived token path:
 *   App signs a challenge with its Ed25519 private key →
 *   POST /auth/api/apps/token →
 *   { token, expiresIn, scopes }
 *
 * The token is a JWT whose `sub` claim carries the userDid.
 *
 * Reference: ima-jin/imajin-ai apps/kernel/app/auth/api/apps/token/route.ts
 */

import * as ed from '@noble/ed25519';
import { randomBytes } from 'node:crypto';

const DEFAULT_KERNEL_URL = 'https://imajin.ai';
const TOKEN_TTL_SECONDS = 600;
const REFRESH_RATIO = 0.8;
const REFRESH_INTERVAL_MS = TOKEN_TTL_SECONDS * REFRESH_RATIO * 1000; // 480 000 ms

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AppTokenResponse {
  token: string;
  expiresIn: number;
  scopes: string[];
}

export interface AppAuthContext {
  token: string;
  userDid: string;
  scopes: string[];
}

// ---------------------------------------------------------------------------
// Internal utilities
// ---------------------------------------------------------------------------

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Decode a JWT payload without verifying the signature.
 * Safe to use on freshly-minted kernel tokens we just received.
 */
function decodeJwtPayload(token: string): Record<string, unknown> {
  const parts = token.split('.');
  if (parts.length < 2) throw new Error('Invalid JWT: expected 3 parts');
  const padded = parts[1].replaceAll('-', '+').replaceAll('_', '/');
  return JSON.parse(Buffer.from(padded, 'base64').toString('utf-8')) as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// mintAppToken — proof-of-possession → short-lived bearer token
// ---------------------------------------------------------------------------

/**
 * Mint a short-lived app token by proving possession of the app's Ed25519 key.
 *
 * With an `attestationId` (a specific supplier's own consent attestation),
 * the minted token's `sub` resolves to that supplier's userDid — the app is
 * acting *for* them. Without one, the app authenticates as **itself**: no
 * consent attestation is involved because there is no human being acted for
 * — this is the app checking a fact about its own identity (e.g. its own
 * org-level connector configuration), not a request made on a supplier's
 * behalf.
 *
 * Challenge signed:
 *   - with attestation:    `${appDid}:${attestationId}:${nonce}:${timestamp}`
 *   - self (no attestation): `${appDid}:${nonce}:${timestamp}`
 * Endpoint: POST {kernelUrl}/auth/api/apps/token
 */
export async function mintAppToken(opts: {
  kernelUrl?: string;
  appDid: string;
  /** Omit for a self-authenticated (app-as-itself) token — no consent attestation. */
  attestationId?: string;
  /** Ed25519 seed as hex (32 bytes = 64 hex chars) */
  privateKey: string;
  scope?: string;
}): Promise<AppTokenResponse> {
  const kernelUrl = (opts.kernelUrl ?? DEFAULT_KERNEL_URL).replace(/\/$/, '');
  const nonce = randomBytes(16).toString('hex'); // 32 hex chars — satisfies ≥ 16 requirement
  const timestamp = new Date().toISOString();
  const challenge = opts.attestationId
    ? `${opts.appDid}:${opts.attestationId}:${nonce}:${timestamp}`
    : `${opts.appDid}:${nonce}:${timestamp}`;

  const msgBytes = new TextEncoder().encode(challenge);
  const privKeyBytes = hexToBytes(opts.privateKey);
  const sigBytes = await ed.signAsync(msgBytes, privKeyBytes);
  const signature = bytesToHex(sigBytes);

  const endpoint = opts.attestationId
    ? `${kernelUrl}/auth/api/apps/token`
    : `${kernelUrl}/auth/api/apps/token/service`;

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      appDid: opts.appDid,
      ...(opts.attestationId !== undefined ? { attestationId: opts.attestationId } : {}),
      nonce,
      timestamp,
      signature,
      ...(opts.scope !== undefined ? { scope: opts.scope } : {}),
    }),
    cache: 'no-store',
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: res.statusText })) as { error?: string };
    throw new Error(`Token mint failed: ${res.status} ${data.error ?? res.statusText}`);
  }

  return res.json() as Promise<AppTokenResponse>;
}

// ---------------------------------------------------------------------------
// resolveAppAuth — mint + decode userDid from JWT sub
// ---------------------------------------------------------------------------

/**
 * Mint an app token and resolve the `userDid` from its JWT payload.
 * This completes the "app-auth handshake" described in issue #2.
 */
export async function resolveAppAuth(opts: {
  kernelUrl?: string;
  appDid: string;
  attestationId: string;
  privateKey: string;
  scope?: string;
}): Promise<AppAuthContext> {
  const { token, scopes } = await mintAppToken(opts);
  const payload = decodeJwtPayload(token);
  const userDid = payload.sub as string | undefined;
  if (!userDid) throw new Error('Kernel token missing sub claim (userDid)');
  return { token, userDid, scopes };
}

// ---------------------------------------------------------------------------
// TokenProvider — cached, auto-refreshing token (mirrors broker-agent pattern)
// ---------------------------------------------------------------------------

/**
 * Manages the app's token lifecycle:
 *   - Mints on first use
 *   - Auto-refreshes at 80% of TTL (≈ 8 min for a 10-min token)
 *   - Exposes `invalidate()` for forced refresh on unexpected 401s
 */
export class TokenProvider {
  private readonly kernelUrl: string;
  private readonly appDid: string;
  private readonly privateKey: string;
  /** Omitted for a self-authenticated provider (app-as-itself, no consent attestation). */
  private readonly attestationId?: string;
  private readonly scope?: string;

  private cachedToken: string | null = null;
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private mintPromise: Promise<void> | null = null;

  constructor(opts: {
    kernelUrl?: string;
    appDid: string;
    privateKey: string;
    attestationId?: string;
    scope?: string;
  }) {
    this.kernelUrl = (opts.kernelUrl ?? DEFAULT_KERNEL_URL).replace(/\/$/, '');
    this.appDid = opts.appDid;
    this.privateKey = opts.privateKey;
    this.attestationId = opts.attestationId;
    this.scope = opts.scope;
  }

  /** Return the current token, minting one if necessary. */
  async getToken(): Promise<string> {
    if (!this.cachedToken) {
      // Coalesce concurrent callers onto a single mint
      this.mintPromise ??= this.refresh().finally(() => { this.mintPromise = null; });
      await this.mintPromise;
    }
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    return this.cachedToken!;
  }

  /** Force refresh on next call (e.g. after a 401). */
  invalidate(): void {
    this.cachedToken = null;
  }

  /** Stop the auto-refresh timer (call on graceful shutdown). */
  dispose(): void {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
  }

  private async refresh(): Promise<void> {
    const { token } = await mintAppToken({
      kernelUrl: this.kernelUrl,
      appDid: this.appDid,
      attestationId: this.attestationId,
      privateKey: this.privateKey,
      scope: this.scope,
    });
    this.cachedToken = token;

    if (this.refreshTimer) clearInterval(this.refreshTimer);
    this.refreshTimer = setInterval(() => {
      this.refresh().catch((err: unknown) => {
        console.error('[agriFortress] Token auto-refresh failed:', err);
        this.cachedToken = null; // force fresh mint on next call
      });
    }, REFRESH_INTERVAL_MS);
  }
}
