/**
 * POST /api/supply/deliver
 *
 * Orchestrates the two-step kernel sequence for the AgriFortress delivery gesture:
 *   1. POST /supply/api/declared  → mints the lot (correlationId = lotId)
 *   2. POST /supply/api/received  → signs the receipt threaded on that lotId
 *
 * Both kernel calls are server-side with app Bearer auth (fetchKernel).
 * The signed events pin issuer/subject = the token's userDid (Scott), enforced
 * kernel-side — this route never touches DIDs directly.
 *
 * Partial failure: if declared succeeds but received fails the lot exists but
 * has no receipt. We return 207 with both stage outcomes so the client can
 * surface an honest error rather than claiming a receipt that was never signed.
 *
 * Request body (JSON):
 *   commodity  string   required  e.g. "eggs"
 *   quantity   number   required  e.g. 6
 *   unit       string   required  e.g. "dozen"
 *   priorCid   string   optional  provenance link to a prior stage record
 *
 * Responses:
 *   401  No active session
 *   400  Invalid / missing body fields
 *   201  { ok: true, declared: SupplyStageResponse, received: SupplyStageResponse }
 *   207  { ok: false, declared: SupplyStageResponse, received: null, error: string }
 *   502  Both calls failed (declared threw)
 *
 * Issue: catalyst-power/xprize#4
 */

import { NextResponse, type NextRequest } from 'next/server';
import { getSession } from '@/lib/session';
import { declareSupplyLot, confirmDelivery, type SupplyStageResponse } from '@/lib/supply';

export const dynamic = 'force-dynamic';

interface DeliverRequestBody {
  commodity: string;
  quantity: number;
  unit: string;
  priorCid?: string;
}

interface DeliverSuccessResponse {
  ok: true;
  declared: SupplyStageResponse;
  received: SupplyStageResponse;
}

interface DeliverPartialResponse {
  ok: false;
  declared: SupplyStageResponse;
  received: null;
  error: string;
}

export async function POST(request: NextRequest) {
  // Session guard — all kernel calls must be on behalf of an authenticated user.
  const user = await getSession();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Parse and validate the request body.
  let body: DeliverRequestBody;
  try {
    body = (await request.json()) as DeliverRequestBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { commodity, quantity, unit, priorCid } = body;

  if (typeof commodity !== 'string' || !commodity) {
    return NextResponse.json({ error: 'commodity (string) is required' }, { status: 400 });
  }
  if (typeof quantity !== 'number') {
    return NextResponse.json({ error: 'quantity (number) is required' }, { status: 400 });
  }
  if (typeof unit !== 'string' || !unit) {
    return NextResponse.json({ error: 'unit (string) is required' }, { status: 400 });
  }

  // Step 1: declare — mints the lot. correlationId IS the lotId.
  let declared: SupplyStageResponse;
  try {
    declared = await declareSupplyLot({ commodity, quantity, unit }, user.attestationId);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `supply.declared failed: ${message}` }, { status: 502 });
  }

  // Step 2: received — signs the receipt threaded on the minted lot.
  // Honest partial-failure: if this throws, the lot exists but has no receipt.
  try {
    const received = await confirmDelivery(
      {
        lotId: declared.correlationId,
        commodity,
        quantity,
        unit,
        ...(priorCid !== undefined ? { priorCid } : {}),
      },
      user.attestationId,
    );

    const result: DeliverSuccessResponse = { ok: true, declared, received };
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const result: DeliverPartialResponse = {
      ok: false,
      declared,
      received: null,
      error: `supply.received failed (lot ${declared.correlationId} was declared but receipt was not signed): ${message}`,
    };
    return NextResponse.json(result, { status: 207 });
  }
}
