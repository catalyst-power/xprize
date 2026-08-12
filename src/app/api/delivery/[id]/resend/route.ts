/**
 * POST /api/delivery/[id]/resend
 *
 * Manual resend action (xprize#75) for the delivery detail view — both
 * /delivery/[id] (xprize#76) and the ?lot= dashboard variant render the
 * same `DeliveryReceipt`, which surfaces the "Resend notification" button
 * that calls this route. Re-sends the same counterparty kernel chat DM the
 * confirm route fires once at delivery time (xprize#73) and, same as that
 * confirm-time behavior (xprize#59), re-fires the connection invite when
 * the recipient still isn't an active AgriFortress user.
 *
 * Unlike the confirm-time notification (fire-and-forget, never blocking the
 * delivery outcome), this route IS the requested action, so both the chat
 * send and the outcome are awaited and reported back to the caller — a
 * silent "resend" that actually failed would violate the claim boundary
 * just as badly as the silent invite failure fixed in xprize#77.
 *
 * `id` is the lot correlationId — the same value /delivery/[id] and
 * ?lot={correlationId} use.
 *
 * Responses:
 *   401  No active session
 *   400  No signed delivery yet on this lot, or its recipient DID is unknown
 *   200  { skipped: true, reason } | { notified: true, inviteSent, inviteFailed }
 *   502  Kernel lot read or chat send failed
 *
 * Issue: catalyst-power/xprize#75
 */

import { NextResponse, type NextRequest } from 'next/server';
import { getSession } from '@/lib/session';
import { getLotChain, resolveActiveRecipientDids } from '@/lib/supply';
import { isReceiptBilateral } from '@/lib/kernel/attestations';
import { sendDirectMessage } from '@/lib/kernel/chat';
import { createConnectionInvite } from '@/lib/kernel/identity';
import { toReceiptPayload } from '@/app/dashboard/DeliveryReceipt';
import { buildResendMessage, resolveRecipientDid } from '@/lib/reminders';
import { cacheRecipientDid, getDeliveryNotifyRecord, markStopped } from '@/lib/deliveryNotifyStore';

export const dynamic = 'force-dynamic';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getSession();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id: correlationId } = await params;

  const chain = await getLotChain(correlationId, user.attestationId).catch((err: unknown) => {
    console.error('[delivery/resend] Lot chain read failed:', err);
    return null;
  });
  if (chain === null) {
    return NextResponse.json({ error: 'Could not read this delivery from the kernel' }, { status: 502 });
  }

  const receivedStage = chain.stages.find((s) => s.stage === 'received');
  if (receivedStage === undefined) {
    return NextResponse.json(
      { error: 'This lot has no signed delivery to notify about yet' },
      { status: 400 },
    );
  }

  const supplierDid = chain.lot.originatingDid;
  const bilateral = await isReceiptBilateral(supplierDid, correlationId).catch(() => false);
  if (bilateral) {
    markStopped(correlationId);
    return NextResponse.json(
      { skipped: true, reason: 'Recipient has already signed \u2014 no reminder needed.' },
      { status: 200 },
    );
  }

  const recipientDid = resolveRecipientDid(
    getDeliveryNotifyRecord(correlationId)?.recipientDid,
    toReceiptPayload(receivedStage.payload).recipient,
  );
  if (recipientDid === undefined) {
    return NextResponse.json(
      {
        error:
          'Recipient DID for this delivery is unknown \u2014 share the receipt link with them directly instead.',
      },
      { status: 400 },
    );
  }

  try {
    await sendDirectMessage(recipientDid, buildResendMessage(correlationId), user.attestationId);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[delivery/resend] Counterparty notification failed:', message);
    return NextResponse.json({ error: message }, { status: 502 });
  }

  cacheRecipientDid(correlationId, recipientDid);

  // Best-effort connection invite re-fire (xprize#59) for a recipient who
  // still isn't an active AgriFortress user. Never blocks or overrides the
  // notification outcome above (claim boundary, AGENTS.md §4) — a failure
  // here is surfaced as a small `inviteFailed` flag, same non-blocking
  // posture as the confirm-time invite send.
  let inviteSent = false;
  let inviteFailed = false;
  try {
    const activeRecipientDids = await resolveActiveRecipientDids(supplierDid, user.attestationId);
    if (!activeRecipientDids.has(recipientDid)) {
      inviteSent = true;
      await createConnectionInvite(
        { delivery: 'link', note: 'AgriFortress delivery pending \u2014 countersign to claim it.' },
        user.attestationId,
      );
    }
  } catch (err) {
    inviteFailed = true;
    console.error('[delivery/resend] Connection invite resend failed:', err);
  }

  return NextResponse.json({ notified: true, inviteSent, inviteFailed }, { status: 200 });
}
