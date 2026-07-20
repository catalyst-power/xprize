/**
 * Self-contained app-auth client for AgriFortress.
 *
 * This is an EXTERNAL client — it talks to the Imajin kernel public API only.
 * No workspace:* deps, no monorepo internals, no direct DB access.
 *
 * Handshake:
 *   1. App sends X-App-DID + X-App-Authorization (or Bearer <app-token>)
 *   2. Kernel verifies at /api/apps/token/verify (stateless, no DB hit)
 *   3. Returns { appDid, userDid, scopes, attestationId }
 *
 * The app acts on-behalf-of the user; provenance pins to userDid.
 */

export interface AppAuthContext {
  appDid: string;
  userDid: string;
  scopes: string[];
  attestationId: string;
}

export type AppAuthResult =
  | { ok: true; auth: AppAuthContext }
  | { ok: false; error: string; status: number };

const getAuthUrl = (): string | undefined => {
  const url = process.env.AUTH_SERVICE_URL;
  if (!url) {
    return undefined;
  }
  return url.replace(/\/$/, '');
};

/**
 * Verify a short-lived scoped app token (Bearer) against the kernel.
 */
async function verifyBearerAppToken(
  token: string,
  scope?: string
): Promise<AppAuthResult> {
  const authUrl = getAuthUrl();
  if (!authUrl) {
    return { ok: false, error: 'Auth service unavailable', status: 503 };
  }

  try {
    const res = await fetch(`${authUrl}/api/apps/token/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, scope }),
      cache: 'no-store',
    });

    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      return {
        ok: false,
        error: data.error ?? 'Invalid app token',
        status: res.status,
      };
    }

    const auth = (await res.json()) as AppAuthContext;
    return { ok: true, auth };
  } catch (err) {
    return { ok: false, error: 'Auth service unreachable', status: 503 };
  }
}

/**
 * Require app authentication from incoming request headers.
 *
 * Supports two paths:
 *   - Bearer <app-token>  (preferred, short-lived scoped token)
 *   - X-App-DID + X-App-Authorization  (legacy attestation flow)
 *
 * @param request - Incoming Request (works with both Request and NextRequest)
 * @param options.scope - Optional required scope to enforce
 */
export async function requireAppAuth(
  request: Request,
  options?: { scope?: string }
): Promise<AppAuthResult> {
  const bearer = request.headers.get('authorization');
  if (bearer?.startsWith('Bearer ')) {
    return verifyBearerAppToken(bearer.slice(7), options?.scope);
  }

  const appDid = request.headers.get('x-app-did');
  const attestationId = request.headers.get('x-app-authorization');

  if (!appDid || !attestationId) {
    return {
      ok: false,
      error:
        'Authorization Bearer <app-token>, or X-App-DID + X-App-Authorization headers required',
      status: 401,
    };
  }

  const authUrl = getAuthUrl();
  if (!authUrl) {
    return { ok: false, error: 'Auth service unavailable', status: 503 };
  }

  try {
    const res = await fetch(`${authUrl}/api/apps/validate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        appDid,
        attestationId,
        scope: options?.scope,
      }),
      cache: 'no-store',
    });

    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      return {
        ok: false,
        error: data.error ?? 'Invalid app authorization',
        status: res.status,
      };
    }

    const auth = (await res.json()) as AppAuthContext;
    return { ok: true, auth };
  } catch (err) {
    return { ok: false, error: 'Auth service unreachable', status: 503 };
  }
}
