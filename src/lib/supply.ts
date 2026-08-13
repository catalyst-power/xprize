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

import { fetchKernel, fetchKernelAsSelf, fetchKernelAtUrl } from './kernel/client';
import { looksLikeDid } from './reminders';

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
  /**
   * The counterparty DID being asked to countersign this delivery —
   * additive `recipientDid` field on `POST /supply/api/received`
   * (ima-jin/imajin-ai#1820/#1821). When supplied, the kernel names the
   * caller (`userDid`) as issuer and this DID as subject, and its bus
   * reactor best-effort-notifies the recipient (email/in-app, preference
   * gated) with a deep link to countersign. Omitted = today's self-attested
   * behavior (`issuer === subject`), unchanged.
   *
   * Additive and backward-compatible: sending this to a kernel that hasn't
   * deployed #1821 yet is a no-op (extra JSON body fields are ignored), so
   * this is safe to ship ahead of that kernel PR merging.
   *
   * `confirmDelivery` only forwards this when it looks like a real DID
   * (`looksLikeDid`, src/lib/reminders.ts — the same guard the reminder
   * ladder uses) — never an empty string or a free-text placeholder for an
   * unclaimed recipient stub. The kernel falls back cleanly to a
   * self-attested receipt when the field is absent.
   *
   * Note: `originUrl` is deliberately NOT threaded through this call.
   * Per the #1821 diff, `publishReceiptStage()` (the handler for this
   * route) never reads an `originUrl` body field — that threading only
   * exists on the kernel's internal, server-to-server attestation-creation
   * path (`emitAttestation()` → `attestations/internal`), which this app
   * never calls directly. Sending it here would just be a dropped field.
   */
  recipientDid?: string;
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

/**
 * Read the lot chain for a given correlationId, acting as the app's own
 * session-less service identity rather than any supplier's attestation.
 *
 * GET /supply/api/lot/{correlationId} — app-auth-gated (supply:read).
 * `handleLotGet` only checks the token's `supply:read` scope, never the
 * caller's identity, so the app's own `app-service+jwt` (minted via
 * `fetchKernelAsSelf`, sub = azp = APP_DID, no borrowed human attestation)
 * satisfies it exactly like a user-delegated token would. This is the
 * webhook-triggered read path (no human session exists to supply an
 * attestation) — see `attemptSettleFromStripe` in `settlementFlow.ts`.
 * Kernel-side credential confirmed end-to-end in ima-jin/imajin-ai#1800/#1802.
 *
 * Server-side only. Never pass a human attestationId here — use `getLotChain`
 * for any call made on behalf of a specific signed-in supplier.
 */
export async function getLotChainAsSelf(correlationId: string): Promise<LotChain> {
  const res = await fetchKernelAsSelf(`/supply/api/lot/${encodeURIComponent(correlationId)}`, {
    method: 'GET',
  });

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
 * Convenience wrapper around the xprize#59 "active on AgriFortress"
 * heuristic: fetches a supplier's recent lots and their chains, then scans
 * every stage for a mentioned recipient DID (`collectRecipientDids`).
 * Mirrors the inline computation in dashboard/page.tsx; extracted here so
 * other server-side call sites (delivery resend/reminders, xprize#75) can
 * reuse the same heuristic without duplicating the fetch-chains dance. Any
 * individual lot or lot-chain fetch failure is non-fatal (fail-open, same
 * as the dashboard) rather than failing the whole scan.
 */
export async function resolveActiveRecipientDids(
  supplierDid: string,
  attestationId: string,
  limit = 20,
): Promise<Set<string>> {
  const lots = await recentLots(supplierDid, attestationId, limit).catch(() => []);
  const chains = await Promise.all(
    lots.map((lot) => getLotChain(lot.correlationId, attestationId).catch((): LotChain | null => null)),
  );
  return collectRecipientDids(chains.filter((chain): chain is LotChain => chain !== null));
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
  // #1820/#1821 — never forward a blank or non-DID recipientDid: an absent
  // field is the kernel's documented signal to fall back to a self-attested
  // receipt, whereas an empty string would be a garbage subject.
  const { recipientDid, ...rest } = body;
  const outgoing = looksLikeDid(recipientDid) ? { ...rest, recipientDid } : rest;

  const res = await fetchKernel(
    '/supply/api/received',
    { method: 'POST', body: JSON.stringify(outgoing) },
    attestationId,
  );

  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: res.statusText })) as { error?: string };
    throw new Error(`supply.received failed: ${res.status} ${data.error ?? res.statusText}`);
  }

  return res.json() as Promise<SupplyStageResponse>;
}

// ---------------------------------------------------------------------------
// Inference → supply bridge (xprize#88)
//
// The kernel's agrifortress inference vocabulary resolver signs a
// `supply.received`-labeled attestation on confirm, but never creates a
// real supply-domain lot record — `getLotChain()`/`recentLots()` (and by
// extension `collectRecipientDids()`) read from the supply domain, not from
// attestations, so no lot ever showed up there and every recipient looked
// like "invite required" forever (root cause of #88).
//
// Design decision (Ryan, xprize#88): this bridge is APP-SIDE — the kernel
// gets no reactor for it. After a successful `confirmInference()`, this app
// calls `POST /supply/api/received` itself with the confirmed metadata so
// the lot chain that `collectRecipientDids()` scans actually exists.
// ---------------------------------------------------------------------------

export interface MaterializeInferenceLotRequest {
  /** The `supply.received` lot correlationId — `InferenceConfirmResponse.externalId`. */
  lotId: string;
  commodity: string;
  quantity: number;
  unit: string;
  /** Same DID guard as `SupplyReceivedRequest.recipientDid` — see its doc comment. */
  recipientDid?: string;
}

/**
 * Materialize a supply lot for a confirmed inference delivery (xprize#88).
 *
 * Gated on its own `AGRIFORTRESS_SUPPLY_API_URL` env var — mirroring the
 * kernel vocabulary resolver's own `SUPPLY_API_URL` feature flag — rather
 * than the always-configured `KERNEL_URL`. This keeps lot materialization
 * an explicit per-environment opt-in that matches the kernel-side flag it
 * is meant to complement (both were UNSET everywhere as of xprize#88).
 *
 * Degrades gracefully when unset: logs a warning and skips the call
 * entirely rather than throwing, so a missing env var can never break the
 * inference confirm response that already succeeded (the signed attestation
 * is the source of truth — this lot is only a derived, additive index).
 *
 * `attestationId` must be the acting user's own session attestation.
 */
export async function materializeInferenceSupplyLot(
  request: MaterializeInferenceLotRequest,
  attestationId: string,
): Promise<SupplyStageResponse | undefined> {
  const supplyApiUrl = process.env.AGRIFORTRESS_SUPPLY_API_URL;
  if (supplyApiUrl === undefined || supplyApiUrl === '') {
    console.warn(
      '[supply] AGRIFORTRESS_SUPPLY_API_URL not configured — supply lot not materialized',
    );
    return undefined;
  }

  // #1820/#1821 — same DID guard as confirmDelivery: never forward a blank
  // or non-DID recipientDid.
  const { recipientDid, ...rest } = request;
  const outgoing = looksLikeDid(recipientDid) ? { ...rest, recipientDid } : rest;

  const res = await fetchKernelAtUrl(
    supplyApiUrl,
    '/supply/api/received',
    { method: 'POST', body: JSON.stringify(outgoing) },
    attestationId,
  );

  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: res.statusText })) as { error?: string };
    throw new Error(
      `supply.received (inference bridge) failed: ${res.status} ${data.error ?? res.statusText}`,
    );
  }

  return res.json() as Promise<SupplyStageResponse>;
}
