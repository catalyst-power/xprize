/**
 * GET /api/health/kernel
 *
 * Smoke call: mints a short-lived app token via the Imajin kernel (proof-of-
 * possession flow) and resolves the `userDid` from the JWT payload.
 *
 * Acceptance criterion for issue #2:
 *   "Completes the app-auth handshake against the kernel and resolves a userDid."
 *
 * Requires env vars: APP_DID, APP_PRIVATE_KEY, APP_ATTESTATION_ID
 */

import { NextResponse } from 'next/server';
import { resolveAppAuth } from '@/lib/kernel/auth';

export const dynamic = 'force-dynamic';

export async function GET() {
  const appDid = process.env.APP_DID;
  const privateKey = process.env.APP_PRIVATE_KEY;
  const attestationId = process.env.APP_ATTESTATION_ID;
  const kernelUrl = process.env.KERNEL_URL ?? 'https://imajin.ai';

  if (!appDid || !privateKey || !attestationId) {
    return NextResponse.json(
      {
        status: 'misconfigured',
        error: 'APP_DID, APP_PRIVATE_KEY, and APP_ATTESTATION_ID env vars are required',
      },
      { status: 503 },
    );
  }

  try {
    const { userDid, scopes } = await resolveAppAuth({
      kernelUrl,
      appDid,
      privateKey,
      attestationId,
    });

    return NextResponse.json({ status: 'ok', userDid, scopes, kernelUrl });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ status: 'error', error: message }, { status: 502 });
  }
}
