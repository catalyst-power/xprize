/**
 * POST /api/supply/deliver
 *
 * One-shot delivery receipt: fires supply.declared → supply.received
 * server-side with the app's Bearer token, pinning issuer/subject to
 * the session user's DID.
 *
 * Body: { commodity: string, quantity: number, unit: string, recipient?: string }
 *
 * Returns: { ok: true, correlationId, stage: "received" } on success,
 * or a partial-failure shape when declared succeeds but received fails.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { fetchKernel } from '@/lib/kernel/client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DeliverBody {
  commodity: string;
  quantity: number;
  unit: string;
  recipient?: string;
}

interface KernelStageResponse {
  ok: boolean;
  correlationId: string;
  stage: string;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function validateBody(body: unknown): body is DeliverBody {
  if (typeof body !== 'object' || body === null) return false;
  const b = body as Record<string, unknown>;
  if (typeof b.commodity !== 'string' || b.commodity.trim().length === 0) return false;
  if (typeof b.quantity !== 'number' || b.quantity <= 0) return false;
  if (typeof b.unit !== 'string' || b.unit.trim().length === 0) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  // 1. Auth — require a valid user session
  const user = await getSession();
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  // 2. Parse + validate body
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (!validateBody(body)) {
    return NextResponse.json(
      { error: 'Missing or invalid fields: commodity (string), quantity (number > 0), unit (string)' },
      { status: 400 },
    );
  }

  // 3. Step 1 — supply.declared (mint the lot)
  const declaredRes = await fetchKernel('/supply/api/declared', {
    method: 'POST',
    body: JSON.stringify({
      commodity: body.commodity,
      quantity: body.quantity,
      unit: body.unit,
    }),
  });

  if (!declaredRes.ok) {
    const err = await declaredRes.json().catch(() => ({ error: declaredRes.statusText })) as { error?: string };
    return NextResponse.json(
      { error: `Declared failed: ${err.error ?? declaredRes.statusText}` },
      { status: declaredRes.status },
    );
  }

  const declared = await declaredRes.json() as KernelStageResponse;

  // 4. Step 2 — supply.received (signed delivery receipt)
  const receivedRes = await fetchKernel('/supply/api/received', {
    method: 'POST',
    body: JSON.stringify({
      lotId: declared.correlationId,
      commodity: body.commodity,
      quantity: body.quantity,
      unit: body.unit,
    }),
  });

  if (!receivedRes.ok) {
    // Partial failure — declared succeeded but received failed.
    // Surface honest error with the lotId so the user can retry.
    const err = await receivedRes.json().catch(() => ({ error: receivedRes.statusText })) as { error?: string };
    return NextResponse.json(
      {
        error: `Receipt failed (lot created but not received): ${err.error ?? receivedRes.statusText}`,
        partialLotId: declared.correlationId,
        stage: 'declared',
      },
      { status: receivedRes.status },
    );
  }

  const received = await receivedRes.json() as KernelStageResponse;

  // 5. Success — signed delivery receipt exists
  return NextResponse.json(
    {
      ok: true,
      correlationId: received.correlationId,
      stage: received.stage,
    },
    { status: 201 },
  );
}
