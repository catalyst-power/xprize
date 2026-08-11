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
import { confirmInference, type ConfirmIntentBody } from '@/lib/inference';

export const dynamic = 'force-dynamic';

/**
 * Read the optional confirmed/edited delivery card from the request body.
 * The body is optional — an empty request (no body at all) is valid and
 * confirms the inferred candidate as-is, same as before xprize#55.
 */
async function readConfirmBody(request: NextRequest): Promise<ConfirmIntentBody | undefined> {
  const raw = await request.text();
  if (!raw) return undefined;
  return JSON.parse(raw) as ConfirmIntentBody;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  // Session guard — kernel calls must be on behalf of an authenticated user.
  const user = await getSession();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { sessionId } = await params;

  let body: ConfirmIntentBody | undefined;
  try {
    body = await readConfirmBody(request);
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  try {
    const result = await confirmInference(sessionId, user.attestationId, body);
    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
