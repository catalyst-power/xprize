/**
 * GET /api/health/kernel
 *
 * Smoke call: mints a short-lived app token via the Imajin kernel (proof-of-
 * possession flow) and, when a diagnostic attestation is configured,
 * resolves the `userDid` from the JWT payload.
 *
 * Acceptance criterion for issue #2:
 *   "Completes the app-auth handshake against the kernel and resolves a userDid."
 *
 * APP_ATTESTATION_ID is NOT used anywhere in the real per-user auth flow —
 * src/lib/kernel/client.ts mints every token from the acting supplier's own
 * session attestation (`SessionUser.attestationId`), never from an env var.
 * (It IS reused elsewhere as a session-less stopgap credential — see the
 * Stripe webhook's settlement read in src/app/api/webhooks/stripe/route.ts —
 * but that is unrelated to any supplier's own connections/lots reads.) Here
 * it remains the one legitimate diagnostic use of APP_ATTESTATION_ID
 * (xprize#36): an *optional* knob that, when set, upgrades this check to the
 * fuller "handshake + resolve userDid" flow. Without it, this previously
 * 503'd as "misconfigured" even when the app's actual required config
 * (APP_DID + APP_PRIVATE_KEY, exactly what fetchKernel/fetchKernelAsSelf
 * need) was perfectly healthy — a false alarm that says nothing about
 * whether any real supplier's own per-session kernel calls (e.g. the
 * Recipient selector's connections:read fetch) are working. It now falls
 * back to a self-authenticated connectivity check instead.
 *
 * Required env vars: APP_DID, APP_PRIVATE_KEY.
 * Optional env var: APP_ATTESTATION_ID (enables the userDid-resolving check).
 */

import { NextResponse } from 'next/server';
import { mintAppToken, resolveAppAuth } from '@/lib/kernel/auth';

export const dynamic = 'force-dynamic';

export async function GET() {
  const appDid = process.env.APP_DID;
  const privateKey = process.env.APP_PRIVATE_KEY;
  const attestationId = process.env.APP_ATTESTATION_ID;
  const kernelUrl = process.env.KERNEL_URL ?? 'https://imajin.ai';

  if (!appDid || !privateKey) {
    return NextResponse.json(
      {
        status: 'misconfigured',
        error: 'APP_DID and APP_PRIVATE_KEY env vars are required',
      },
      { status: 503 },
    );
  }

  try {
    if (attestationId) {
      const { userDid, scopes } = await resolveAppAuth({
        kernelUrl,
        appDid,
        privateKey,
        attestationId,
      });

      return NextResponse.json({ status: 'ok', userDid, scopes, kernelUrl });
    }

    // No diagnostic attestation configured — fall back to a self-authenticated
    // connectivity check (same identity/endpoint as fetchKernelAsSelf) so this
    // still verifies APP_DID + APP_PRIVATE_KEY are valid without requiring an
    // env var the real per-user flow never touches.
    const { scopes } = await mintAppToken({ kernelUrl, appDid, privateKey });
    return NextResponse.json({ status: 'ok', scopes, kernelUrl });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ status: 'error', error: message }, { status: 502 });
  }
}
