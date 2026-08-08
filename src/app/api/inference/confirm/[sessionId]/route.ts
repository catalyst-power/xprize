/**
 * POST /api/inference/confirm/[sessionId]
 *
 * Advances a pending inference session to `resolved`, signing the chosen
 * candidate intent as a `supply.received` attestation via the agrifortress
 * vocabulary resolver. Returns the signed attestationId.
 *
 * No retry is safe — the intent is signed exactly once. Honest error on
 * failure; no phantom receipt is ever returned (same discipline as #17).
 *
 * Responses:
 *   401  No active session
 *   200  InferenceConfirmResponse { sessionId, status, attestationId, ... }
 *   502  Kernel call failed
 *
 * Issue: catalyst-power/xprize#5
 */

import { NextResponse, type NextRequest } from 'next/server';
import { getSession } from '@/lib/session';
import { confirmInference } from '@/lib/inference';

export const dynamic = 'force-dynamic';

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  // Session guard — kernel calls must be on behalf of an authenticated user.
  const user = await getSession();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { sessionId } = await params;

  try {
    const result = await confirmInference(sessionId, user.attestationId);
    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
