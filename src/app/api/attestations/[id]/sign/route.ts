/**
 * POST /api/attestations/[id]/sign
 *
 * The pending-signatures inbox's sign/countersign action (xprize#74). The
 * recipient of a delivery attestation (or any attestation naming them as
 * subject) has no way to act on it until now — this route countersigns it
 * on their behalf, moving it from `pending` to `bilateral`.
 *
 * Composes two kernel calls:
 *   1. `buildAppWitnessJws` (src/lib/kernel/auth.ts) — builds the
 *      `witnessJws` the kernel's countersign endpoint requires. See that
 *      function's doc comment for why AgriFortress signs it with its own
 *      keypair rather than the subject's own chain key.
 *   2. `countersignAttestation` (src/lib/kernel/attestations.ts) — calls
 *      `POST /auth/api/attestations/countersign` via `fetchKernel`, acting
 *      as the current session user (their own consent attestation).
 *
 * Never calls the kernel from the browser — see AGENTS.md §2.
 *
 * Responses:
 *   401  No active session
 *   200  CountersignResult from the kernel
 *   500  App identity not configured (APP_DID / APP_PRIVATE_KEY missing)
 *   502  Kernel call failed
 *
 * Issue: catalyst-power/xprize#74
 */

import { NextResponse, type NextRequest } from 'next/server';
import { getSession } from '@/lib/session';
import { buildAppWitnessJws } from '@/lib/kernel/auth';
import { countersignAttestation } from '@/lib/kernel/attestations';

export const dynamic = 'force-dynamic';

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  // Session guard — kernel calls must be on behalf of an authenticated user.
  const user = await getSession();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id: attestationId } = await params;

  const appDid = process.env.APP_DID;
  const privateKey = process.env.APP_PRIVATE_KEY;
  if (!appDid || !privateKey) {
    return NextResponse.json({ error: 'App identity not configured' }, { status: 500 });
  }

  try {
    const witnessJws = await buildAppWitnessJws({
      appDid,
      privateKey,
      attestationId,
      subjectDid: user.did,
    });
    const result = await countersignAttestation(attestationId, witnessJws, user.attestationId);
    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[attestations/sign] Kernel countersign failed:', message);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
