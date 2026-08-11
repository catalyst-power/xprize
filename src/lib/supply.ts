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
// LotChain — read contract for GET /supply/api/lot/{correlationId}
// ---------------------------------------------------------------------------

export interface LotChainStage {
  stage: string;
  actorDid: string;
  attestationCid: string | null;
  priorCid: string | null;
  payload: unknown;
  createdAt: string;
}

export interface LotChain {
  lot: {
    correlationId: string;
    originatingDid: string;
    commodity: string | null;
    status: string;
    createdAt: string;
  };
  stages: LotChainStage[];
}

// ---------------------------------------------------------------------------
// RecentLot — read contract for GET /supply/api/lots?supplier={did}&limit={n}
// ---------------------------------------------------------------------------

export interface RecentLot {
  correlationId: string;
  originatingDid: string;
  commodity: string | null;
  status: string;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Client functions
// ---------------------------------------------------------------------------

/**
 * Read the lot chain for a given correlationId.
 * GET /supply/api/lot/{correlationId} — app-auth-gated (supply:read).
 * Server-side only (same transport as declareSupplyLot / confirmDelivery).
 * `correlationId` is the `externalId` returned by `InferenceConfirmResponse`.
 * `attestationId` must be the acting user's own session attestation.
 */
export async function getLotChain(
  correlationId: string,
  attestationId: string,
): Promise<LotChain> {
  const res = await fetchKernel(
    `/supply/api/lot/${encodeURIComponent(correlationId)}`,
    { method: 'GET' },
    attestationId,
  );

  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: res.statusText })) as { error?: string };
    throw new Error(`supply.lot.read failed: ${res.status} ${data.error ?? res.statusText}`);
  }

  return res.json() as Promise<LotChain>;
}

// ---------------------------------------------------------------------------
// "Active on AgriFortress" heuristic (xprize#59)
//
// There is no kernel query for "attestations where DID X was the recipient"
// today, and the DeliveryGesture confirm flow's chosen recipient DID isn't
// even persisted server-side yet (known kernel limitation flagged in
// xprize#57's PR description: the confirm route re-signs from the captured
// session, never reading the request body). So "has this trust-graph
// connection ever been an AgriFortress recipient" can only be answered
// pragmatically from data already available to this app: the supplier's own
// recent lot chains, best-effort-scanned for a recipient DID on any stage.
// Until the kernel persists it, this will honestly resolve to "no signal" —
// a safe default (never asserting familiarity without evidence) rather than
// a broken feature. See the PR description for xprize#58/#59 for the fuller
// writeup of this limitation.
// ---------------------------------------------------------------------------

function extractRecipientDid(payload: unknown): string | undefined {
  if (typeof payload !== 'object' || payload === null) return undefined;
  const record = payload as Record<string, unknown>;
  const candidate = record.recipientDid ?? record.recipient;
  return typeof candidate === 'string' && candidate !== '' ? candidate : undefined;
}

/**
 * Scan a batch of lot chains (e.g. the supplier's recent lots, already
 * fetched for the Recent Deliveries panel) for every recipient DID mentioned
 * on any stage's payload. Used to grey out/annotate trust-graph connections
 * that have never been an AgriFortress recipient before (xprize#59).
 */
export function collectRecipientDids(chains: readonly LotChain[]): Set<string> {
  const dids = new Set<string>();
  for (const chain of chains) {
    for (const stage of chain.stages) {
      const did = extractRecipientDid(stage.payload);
      if (did !== undefined) dids.add(did);
    }
  }
  return dids;
}

/**
 * Read the most recent lots for a supplier.
 * GET /supply/api/lots?supplier={did}&limit={n} — app-auth-gated (supply:read).
 * Returns an empty array when the supplier has no prior lots.
 * Server-side only (same transport as declareSupplyLot / confirmDelivery).
 * `attestationId` must be the acting user's own session attestation.
 */
export async function recentLots(
  supplierDid: string,
  attestationId: string,
  limit = 1,
): Promise<RecentLot[]> {
  const qs = new URLSearchParams({ supplier: supplierDid, limit: String(limit) });
  const res = await fetchKernel(`/supply/api/lots?${qs.toString()}`, { method: 'GET' }, attestationId);

  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: res.statusText })) as { error?: string };
    throw new Error(`supply.lots.read failed: ${res.status} ${data.error ?? res.statusText}`);
  }

  // Kernel returns { lots: RecentLot[] } — ima-jin/imajin-ai@main
  // apps/kernel/src/lib/supply.ts handleLotsBySupplierGet
  const body = await res.json() as { lots: RecentLot[] };
  return body.lots;
}

/**
 * Fire `supply.declared` — mints a new lot.
 * Returns `{ ok, correlationId, stage: 'declared' }`.
 * `correlationId` IS the `lotId`; pass it to `confirmDelivery`.
 * `attestationId` must be the acting user's own session attestation.
 */
export async function declareSupplyLot(
  body: SupplyDeclaredRequest,
  attestationId: string,
): Promise<SupplyStageResponse> {
  const res = await fetchKernel(
    '/supply/api/declared',
    { method: 'POST', body: JSON.stringify(body) },
    attestationId,
  );

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
 * `attestationId` must be the acting user's own session attestation.
 */
export async function confirmDelivery(
  body: SupplyReceivedRequest,
  attestationId: string,
): Promise<SupplyStageResponse> {
  const res = await fetchKernel(
    '/supply/api/received',
    { method: 'POST', body: JSON.stringify(body) },
    attestationId,
  );

  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: res.statusText })) as { error?: string };
    throw new Error(`supply.received failed: ${res.status} ${data.error ?? res.statusText}`);
  }

  return res.json() as Promise<SupplyStageResponse>;
}
