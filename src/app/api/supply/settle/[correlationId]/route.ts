/**
 * POST /api/supply/settle/[correlationId]
 *
 * Attempts to create the settlement invoice for a delivery lot, if (and only
 * if) its `supply.received` attestation is bilateral. Called server-side
 * from `DeliveryReceipt` on every authenticated page view of a lot — this is
 * the only trigger currently available to the app (see the xprize#60 issue
 * comment for why a true kernel bus-reactor trigger isn't wired yet).
 *
 * Idempotent: a repeated call for a lot that already has an invoice/settle
 * attempt in flight is a no-op (see `src/lib/settlementStore.ts`).
 *
 * Responses:
 *   401  No active session
 *   200  SettlementView { state, invoiceId?, checkoutUrl?, totalCents?, error? }
 *
 * Issue: catalyst-power/xprize#60
 */

import { NextResponse, type NextRequest } from 'next/server';
import { getSession } from '@/lib/session';
import { attemptInvoiceCreation } from '@/lib/settlementFlow';

export const dynamic = 'force-dynamic';

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ correlationId: string }> },
) {
  const user = await getSession();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { correlationId } = await params;
  const view = await attemptInvoiceCreation(correlationId, user.attestationId);
  return NextResponse.json(view, { status: 200 });
}
