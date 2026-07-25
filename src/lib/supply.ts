/**
 * Kernel supply domain client for AgriFortress.
 *
 * Wraps the two kernel calls that make up the delivery gesture:
 *   1. POST /supply/api/declared  → mints the lot; returns correlationId = lotId
 *   2. POST /supply/api/received  → signs the receipt threaded on that lotId
 *
 * Both calls are server-side only (never browser → kernel with the app token).
 * Auth is handled transparently by fetchKernel (TokenProvider + Bearer injection).
 *
 * Reference: ima-jin/imajin-ai apps/kernel/src/lib/supply.ts @main
 *   publishSupplyStage  — declared
 *   publishReceiptStage — received (#1384)
 */

import { fetchKernel } from './kernel/client';

// ---------------------------------------------------------------------------
// Request / response types
// ---------------------------------------------------------------------------

export interface SupplyDeclaredRequest {
  commodity: string;
  quantity: number;
  unit: string;
}

export interface SupplyReceivedRequest {
  lotId: string;
  commodity: string;
  quantity: number;
  unit: string;
  /** Optional provenance link to the declared stage's content-addressed record. */
  priorCid?: string;
}

export interface SupplyStageResponse {
  ok: boolean;
  correlationId: string;
  stage: string;
}

// ---------------------------------------------------------------------------
// Client functions
// ---------------------------------------------------------------------------

/**
 * Fire `supply.declared` — mints a new lot.
 * Returns `{ ok, correlationId, stage: 'declared' }`.
 * `correlationId` IS the `lotId`; pass it to `confirmDelivery`.
 */
export async function declareSupplyLot(
  body: SupplyDeclaredRequest,
): Promise<SupplyStageResponse> {
  const res = await fetchKernel('/supply/api/declared', {
    method: 'POST',
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: res.statusText })) as { error?: string };
    throw new Error(`supply.declared failed: ${res.status} ${data.error ?? res.statusText}`);
  }

  return res.json() as Promise<SupplyStageResponse>;
}

/**
 * Fire `supply.received` — signs the delivery receipt threaded on an existing lot.
 * `lotId` must be the `correlationId` returned by `declareSupplyLot`.
 * Returns `{ ok, correlationId, stage: 'received' }`.
 */
export async function confirmDelivery(
  body: SupplyReceivedRequest,
): Promise<SupplyStageResponse> {
  const res = await fetchKernel('/supply/api/received', {
    method: 'POST',
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: res.statusText })) as { error?: string };
    throw new Error(`supply.received failed: ${res.status} ${data.error ?? res.statusText}`);
  }

  return res.json() as Promise<SupplyStageResponse>;
}
