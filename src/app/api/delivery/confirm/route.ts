/**
 * POST /api/delivery/confirm
 *
 * Server-side endpoint that fires the two-stage supply flow:
 *   1. POST /supply/api/declared  → mint lot
 *   2. POST /supply/api/received  → signed receipt
 *
 * Auth: session cookie → userDid. App token is injected server-side
 * via fetchKernel (Bearer, sub = userDid).
 *
 * On success, persists the delivery as the "last delivery" for pre-fill.
 * On partial failure (declared ok, received fails), returns an honest
 * error and does NOT show a phantom receipt.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { declareLot, receiveLot } from '@/lib/delivery/kernel';
import { setLastDelivery, type LastDelivery } from '@/lib/delivery/store';

export const dynamic = 'force-dynamic';

export interface ConfirmRequest {
  customer: string;
  commodity: string;
  quantity: number;
  unit: string;
}

export interface ConfirmResponse {
  ok: boolean;
  correlationId: string;
  stage: 'received';
  customer: string;
  commodity: string;
  quantity: number;
  unit: string;
  date: string;
}

export interface ConfirmError {
  error: string;
  stage?: 'declared' | 'received';
}

export async function POST(req: NextRequest): Promise<NextResponse<ConfirmResponse | ConfirmError>> {
  const user = await getSession();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: ConfirmRequest;
  try {
    body = await req.json() as ConfirmRequest;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { customer, commodity, quantity, unit } = body;
  if (!customer || !commodity || typeof quantity !== 'number' || !unit) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
  }

  // Stage 1: declare
  let declared: { correlationId: string };
  try {
    declared = await declareLot({ commodity, quantity, unit });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message, stage: 'declared' }, { status: 502 });
  }

  // Stage 2: receive (signed receipt)
  let received: { correlationId: string };
  try {
    received = await receiveLot({
      lotId: declared.correlationId,
      commodity,
      quantity,
      unit,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json(
      { error: `Delivery declared but receipt failed: ${message}`, stage: 'received' },
      { status: 502 },
    );
  }

  // Persist for next pre-fill
  const today = new Date().toISOString().slice(0, 10);
  const lastDelivery: LastDelivery = { customer, commodity, unit, quantity, date: today };
  await setLastDelivery(user.did, lastDelivery);

  return NextResponse.json({
    ok: true,
    correlationId: received.correlationId,
    stage: 'received',
    customer,
    commodity,
    quantity,
    unit,
    date: today,
  }, { status: 201 });
}
