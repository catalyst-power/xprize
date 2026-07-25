/**
 * GET /api/delivery/prefill
 *
 * Returns the last delivery for the current user (for UI pre-fill).
 * Falls back to sensible defaults if no prior delivery exists.
 */

import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getLastDelivery } from '@/lib/delivery/store';

export const dynamic = 'force-dynamic';

export interface PrefillResponse {
  customer: string;
  commodity: string;
  unit: string;
  quantity: number;
  date: string;
}

export async function GET(): Promise<NextResponse<PrefillResponse | { error: string }>> {
  const user = await getSession();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const last = await getLastDelivery(user.did);
  const today = new Date().toISOString().slice(0, 10);

  if (last) {
    return NextResponse.json({
      customer: last.customer,
      commodity: last.commodity,
      unit: last.unit,
      quantity: last.quantity,
      date: today,
    });
  }

  // First-time defaults
  return NextResponse.json({
    customer: '',
    commodity: 'eggs',
    unit: 'dozen',
    quantity: 6,
    date: today,
  });
}
