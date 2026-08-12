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
 * On success, when the confirmed card named a recipient DID, best-effort
 * notifies that counterparty via a kernel chat DM linking back to the
 * pending item (xprize#73). Fire-and-forget: never awaited, never affects
 * this route's response, failures are logged server-side.
 *
 * Responses:
 *   401  No active session
 *   200  InferenceConfirmResponse { sessionId, status, attestationId, ... }
 *   502  Kernel call failed
 *
 * Issue: catalyst-power/xprize#5, catalyst-power/xprize#73
 */

import { NextResponse, type NextRequest } from 'next/server';
import { getSession } from '@/lib/session';
import { confirmInference, type ConfirmIntentBody } from '@/lib/inference';
import { sendDirectMessage } from '@/lib/kernel/chat';
import { cacheRecipientDid } from '@/lib/deliveryNotifyStore';

export const dynamic = 'force-dynamic';

const DEFAULT_APP_URL = 'https://integrity.imajin.ai';

function buildDeliveryNotificationMessage(correlationId: string): string {
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? DEFAULT_APP_URL).replace(/\/$/, '');
  const deliveryUrl = `${appUrl}/dashboard?lot=${encodeURIComponent(correlationId)}`;
  return `A delivery attestation is awaiting your signature in AgriFortress: ${deliveryUrl}`;
}

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

    // Counterparty notification (xprize#73) — the attestation is already
    // signed at this point; a failed DM must never look like a failed
    // delivery (claim boundary, AGENTS.md §4), so this is fire-and-forget
    // rather than awaited, and failures are logged server-side (loggable,
    // not swallowed) instead of surfacing in the response. `body.recipient`
    // is the same DID the delivery card's Recipient selector resolved
    // (xprize#55); it's used here rather than re-deriving the subject from
    // the kernel because `POST /api/inference/confirm` doesn't echo the
    // signed attestation's subject back (see the known kernel limitation
    // documented on `ConfirmIntentBody` in src/lib/inference.ts).
    if (body?.recipient !== undefined && body.recipient !== '' && result.externalId !== '') {
      // Cache the real recipient DID now, while it's known for certain
      // (xprize#75) — the `received` stage's own persisted payload may not
      // carry it at all (known kernel limitation documented on
      // `ConfirmIntentBody`), so manual resend and the reminder ladder read
      // this cache instead of re-deriving it later.
      cacheRecipientDid(result.externalId, body.recipient);
      sendDirectMessage(
        body.recipient,
        buildDeliveryNotificationMessage(result.externalId),
        user.attestationId,
      ).catch((err: unknown) => {
        console.error('[inference/confirm] Counterparty delivery notification failed:', err);
      });
    }

    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
