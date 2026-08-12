/**
 * POST /api/delivery/reminders/check
 *
 * Runs the automatic reminder ladder (xprize#75) for one or more suppliers'
 * unsigned deliveries: for each target supplier, scans their recent lots
 * for a signed-but-not-yet-bilateral `received` stage and sends the next
 * due rung (default 5m / 1h / 24h / 7d after signing, configurable via
 * REMINDER_LADDER_MINUTES — see src/lib/reminders.ts) via the same kernel
 * chat DM used for the initial notification (xprize#73) and manual resend
 * (xprize#75). Never sends the same rung twice for the same lot, and stops
 * permanently once the counterparty countersigns (deliveryNotifyStore.ts).
 *
 * There is no cron infrastructure in this app (AGENTS.md §2: no database,
 * no in-process bus), and sending a kernel chat DM is consent-gated on the
 * *supplier's own* session attestation — unlike the read-only
 * `fetchKernelAsSelf` paths used for settlement webhooks, there is no
 * app-service credential that can send a chat message on a supplier's
 * behalf. So a truly anonymous external cron can't drive this; two
 * pragmatic trigger paths are supported instead:
 *
 *   1. Session-authenticated (primary). Called with the signed-in
 *      supplier's own session cookie — see `ReminderTrigger`
 *      (src/app/dashboard/ReminderTrigger.tsx), fired once, fire-and-forget,
 *      on every dashboard page load. This is the closest this app can get
 *      to "cron" without one: honest about only running while the supplier
 *      is actually using the app, same posture as the rest of this app's
 *      session-scoped kernel access.
 *   2. Shared-secret (external cron, opt-in). When REMINDER_CRON_SECRET is
 *      set, a caller presenting `Authorization: Bearer <secret>` may supply
 *      one or more `{ supplierDid, attestationId }` pairs directly in the
 *      JSON body. The caller is responsible for minting/rotating a valid
 *      attestation for each supplier it wants checked (e.g. via the same
 *      consent flow this app's own login uses) — this route has no way to
 *      manufacture one. This lets an external scheduler (e.g. a platform
 *      cron job hitting this route on a fixed interval) drive true
 *      time-based reminders for a small, explicitly-configured set of
 *      suppliers, without this route ever being an open relay (no secret
 *      configured = the shared-secret path is disabled entirely).
 *
 * Responses:
 *   401  Neither a valid session nor a valid shared-secret + targets
 *   400  Body present but not valid JSON
 *   200  { checked: number, sent: ReminderRunResult[] }
 *
 * Issue: catalyst-power/xprize#75
 */

import { NextResponse, type NextRequest } from 'next/server';
import { getSession } from '@/lib/session';
import { getLotChain, recentLots, type LotChain } from '@/lib/supply';
import { isReceiptBilateral } from '@/lib/kernel/attestations';
import { sendDirectMessage } from '@/lib/kernel/chat';
import { toReceiptPayload } from '@/app/dashboard/DeliveryReceipt';
import {
  buildReminderMessage,
  minutesSince,
  nextDueRung,
  resolveReminderLadderMinutes,
  resolveRecipientDid,
} from '@/lib/reminders';
import { getDeliveryNotifyRecord, markRungSent, markStopped } from '@/lib/deliveryNotifyStore';

export const dynamic = 'force-dynamic';

/** How many of a supplier's most recent lots to scan per check — generous enough to cover the default 7-day ladder without scanning the whole history. */
const RECENT_LOTS_SCAN_LIMIT = 25;

export interface ReminderTarget {
  supplierDid: string;
  attestationId: string;
}

interface ReminderCronBody {
  targets?: ReminderTarget[];
}

interface MinimalSession {
  did: string;
  attestationId: string;
}

/**
 * Resolve which supplier(s) to check reminders for, from either the
 * caller's own session (primary path) or an opt-in shared-secret cron body
 * (see the route header for both paths). Returns undefined — never an
 * empty-but-authorized list by accident — when neither auth mode is
 * satisfied, so the route can fail closed with 401.
 */
export function resolveReminderTargets(
  authorizationHeader: string | null,
  cronSecretEnv: string | undefined,
  body: ReminderCronBody | undefined,
  session: MinimalSession | null,
): ReminderTarget[] | undefined {
  if (cronSecretEnv !== undefined && cronSecretEnv !== '' && authorizationHeader === `Bearer ${cronSecretEnv}`) {
    const targets = body?.targets ?? [];
    return targets.filter((t) => t.supplierDid !== '' && t.attestationId !== '');
  }
  if (session !== null) {
    return [{ supplierDid: session.did, attestationId: session.attestationId }];
  }
  return undefined;
}

export interface ReminderRunResult {
  correlationId: string;
  rung?: number;
  sent: boolean;
  reason?: string;
}

/** Check and, if due, send the next reminder rung for a single lot chain. Returns undefined for a lot with nothing to evaluate (no signed delivery yet, or already permanently stopped) so callers can omit it from the report entirely. */
async function processLot(
  chain: LotChain,
  attestationId: string,
  ladderMinutes: readonly number[],
  now: Date,
): Promise<ReminderRunResult | undefined> {
  const correlationId = chain.lot.correlationId;
  const receivedStage = chain.stages.find((s) => s.stage === 'received');
  if (receivedStage === undefined) return undefined;

  const record = getDeliveryNotifyRecord(correlationId);
  if (record?.stoppedAt !== undefined) return undefined;

  const bilateral = await isReceiptBilateral(chain.lot.originatingDid, correlationId).catch(() => false);
  if (bilateral) {
    markStopped(correlationId);
    return { correlationId, sent: false, reason: 'already signed' };
  }

  const recipientDid = resolveRecipientDid(
    record?.recipientDid,
    toReceiptPayload(receivedStage.payload).recipient,
  );
  if (recipientDid === undefined) {
    return { correlationId, sent: false, reason: 'recipient DID unknown' };
  }

  const elapsed = minutesSince(receivedStage.createdAt, now);
  const sentRungs = new Set(record?.sentRungs ?? []);
  const rung = nextDueRung(elapsed, ladderMinutes, sentRungs);
  if (rung === undefined) {
    return { correlationId, sent: false, reason: 'no rung due' };
  }

  try {
    await sendDirectMessage(recipientDid, buildReminderMessage(correlationId, ladderMinutes[rung]), attestationId);
  } catch (err) {
    console.error('[delivery/reminders/check] Reminder send failed:', correlationId, err);
    return { correlationId, sent: false, reason: 'send failed' };
  }

  markRungSent(correlationId, recipientDid, rung);
  return { correlationId, rung, sent: true };
}

async function checkSupplierReminders(
  target: ReminderTarget,
  ladderMinutes: readonly number[],
  now: Date,
): Promise<ReminderRunResult[]> {
  const lots = await recentLots(target.supplierDid, target.attestationId, RECENT_LOTS_SCAN_LIMIT).catch(() => []);
  const chains = await Promise.all(
    lots.map((lot) => getLotChain(lot.correlationId, target.attestationId).catch((): LotChain | null => null)),
  );

  const results: ReminderRunResult[] = [];
  for (const chain of chains) {
    if (chain === null) continue;
    const result = await processLot(chain, target.attestationId, ladderMinutes, now);
    if (result !== undefined) results.push(result);
  }
  return results;
}

async function readCronBody(request: NextRequest): Promise<ReminderCronBody | undefined> {
  const raw = await request.text();
  if (!raw) return undefined;
  return JSON.parse(raw) as ReminderCronBody;
}

export async function POST(request: NextRequest) {
  const session = await getSession();

  let body: ReminderCronBody | undefined;
  try {
    body = await readCronBody(request);
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const targets = resolveReminderTargets(
    request.headers.get('authorization'),
    process.env.REMINDER_CRON_SECRET,
    body,
    session,
  );

  if (targets === undefined) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const ladderMinutes = resolveReminderLadderMinutes();
  const now = new Date();

  const perTarget = await Promise.all(
    targets.map((target) => checkSupplierReminders(target, ladderMinutes, now)),
  );
  const results = perTarget.flat();

  return NextResponse.json({ checked: results.length, sent: results.filter((r) => r.sent) }, { status: 200 });
}
