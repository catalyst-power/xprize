/**
 * DeliveryReceipt ΓÇö async server component.
 *
 * Renders a human-readable delivery receipt from the signed supply.received
 * attestation via GET /supply/api/lot/{correlationId}. This is a read-only
 * lens over the signed lot chain; it does NOT publish, sign, or mutate anything.
 *
 * Epistemics (AGENTS.md ┬º4):
 *   - Quantity shown = the value Scott asserted and signed. Never recomputed.
 *   - Provenance line = "what was signed and by whom", NOT a physical-world truth claim.
 *   - "Signed receipt ┬╖ attestation CID ┬╖ chained to declared CID" is provenance, not verdict.
 *
 * Issue: catalyst-power/xprize#7
 */

import { getLotChain, type LotChain, type LotChainStage } from '@/lib/supply';
import { attemptInvoiceCreation } from '@/lib/settlementFlow';
import type { SettlementView } from '@/lib/settlement';
import { ResendNotification } from './ResendNotification';

// ---------------------------------------------------------------------------
// Pure helpers ΓÇö exported for testing
// ---------------------------------------------------------------------------

/** Find the received stage from a lot chain. */
export function findReceivedStage(chain: LotChain): LotChainStage | undefined {
  return chain.stages.find((s) => s.stage === 'received');
}

/** Display-safe view of the received stage payload. */
export interface ReceivedPayloadView {
  readonly recipient: string | null;
  readonly quantity: string | null;
  readonly unit: string | null;
  readonly commodity: string | null;
}

/**
 * Narrow the received stage payload to display-safe fields.
 * The returned values are the signed asserted values ΓÇö never derived or recomputed.
 */
export function toReceiptPayload(payload: unknown): ReceivedPayloadView {
  if (payload === null || typeof payload !== 'object') {
    return { recipient: null, quantity: null, unit: null, commodity: null };
  }
  const p = payload as Record<string, unknown>;
  return {
    recipient: typeof p['recipient'] === 'string' ? p['recipient'] : null,
    quantity: typeof p['quantity'] === 'number' ? String(p['quantity']) : null,
    unit: typeof p['unit'] === 'string' ? p['unit'] : null,
    commodity: typeof p['commodity'] === 'string' ? p['commodity'] : null,
  };
}

// ---------------------------------------------------------------------------
// Sub-renders
// ---------------------------------------------------------------------------

function ReceiptPending() {
  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
      <p className="text-sm font-medium text-zinc-300 mb-1">Delivery receipt</p>
      <p className="text-xs text-zinc-500">
        Receipt pending ΓÇö delivery receipt has not been signed yet.
      </p>
    </section>
  );
}

function ReceiptError(props: Readonly<{ message: string }>) {
  return (
    <section className="rounded-xl border border-red-900/60 bg-zinc-900/50 p-5">
      <p className="text-sm font-medium text-red-400 mb-1">Receipt unavailable</p>
      <p className="text-xs text-zinc-500 font-mono break-all">{props.message}</p>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Settlement (xprize#60) — pending-invoice / awaiting-payment / settled / error.
// Read-only render over `attemptInvoiceCreation`'s result; never asserts a
// state the kernel didn't actually confirm (real dollars, honest status).
// ---------------------------------------------------------------------------

const SETTLEMENT_STATE_LABEL: Record<SettlementView['state'], string> = {
  'pending-invoice': 'Awaiting countersignature',
  'awaiting-payment': 'Invoice sent — awaiting payment',
  settled: 'Settled',
  error: 'Settlement error',
};

const SETTLEMENT_STATE_CLASSES: Record<SettlementView['state'], string> = {
  'pending-invoice': 'text-zinc-400 border-zinc-700 bg-zinc-900/40',
  'awaiting-payment': 'text-amber-300 border-amber-800 bg-amber-950/30',
  settled: 'text-green-400 border-green-800 bg-green-950/40',
  error: 'text-red-400 border-red-800 bg-red-950/30',
};

function formatDollars(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export function SettlementSection(props: Readonly<{ settlement: SettlementView }>) {
  const { settlement } = props;

  return (
    <div className="border-t border-zinc-800 pt-3 space-y-2">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">
          Settlement
        </p>
        <span
          className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium border ${SETTLEMENT_STATE_CLASSES[settlement.state]}`}
        >
          {SETTLEMENT_STATE_LABEL[settlement.state]}
        </span>
      </div>

      {settlement.totalCents !== undefined && (
        <p className="text-xs text-zinc-300">Total: {formatDollars(settlement.totalCents)}</p>
      )}

      {settlement.invoiceId !== undefined && (
        <p className="text-xs text-zinc-500">
          Invoice <span className="font-mono text-zinc-400">{settlement.invoiceId}</span>
        </p>
      )}

      {settlement.checkoutUrl !== undefined && settlement.state === 'awaiting-payment' && (
        <a
          href={settlement.checkoutUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-block text-xs text-amber-300 underline hover:text-amber-200"
        >
          Pay now (Stripe)
        </a>
      )}

      {settlement.state === 'error' && settlement.error !== undefined && (
        <p className="text-[10px] text-red-400 font-mono break-all">{settlement.error}</p>
      )}

      {settlement.state === 'pending-invoice' && (
        <p className="text-[10px] text-zinc-600 italic">
          Settlement starts once the recipient countersigns this receipt (bilateral).
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export async function DeliveryReceipt(
  props: Readonly<{ correlationId: string; attestationId: string }>,
) {
  const { correlationId, attestationId } = props;

  let chain: LotChain;
  try {
    chain = await getLotChain(correlationId, attestationId);
  } catch (err) {
    return (
      <ReceiptError
        message={err instanceof Error ? err.message : 'Unknown error loading receipt'}
      />
    );
  }

  const receivedStage = findReceivedStage(chain);

  if (receivedStage === undefined) {
    return <ReceiptPending />;
  }

  const { lot } = chain;
  const { actorDid, attestationCid, priorCid, createdAt } = receivedStage;
  const p = toReceiptPayload(receivedStage.payload);
  const settlement = await attemptInvoiceCreation(correlationId, attestationId);

  const commodity = p.commodity ?? lot.commodity ?? 'ΓÇö';
  const quantity = p.quantity ?? 'ΓÇö';
  const unit = p.unit ?? 'ΓÇö';
  const date = new Date(createdAt).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });

  return (
    <section className="rounded-xl border border-zinc-700 bg-zinc-900 p-5 space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-white">Delivery receipt</p>
          <p className="text-xs text-zinc-500 font-mono break-all pt-0.5">
            Lot {lot.correlationId}
          </p>
          {/* Standalone shareable/linkable route (xprize#76) — same receipt, durable URL. */}
          <a
            href={`/delivery/${encodeURIComponent(lot.correlationId)}`}
            className="text-[10px] text-zinc-600 hover:text-zinc-400 underline underline-offset-2"
          >
            Permalink
          </a>
        </div>
        <span className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium text-green-400 border border-green-800 bg-green-950/40 capitalize">
          {lot.status}
        </span>
      </div>

      {/* Body ΓÇö signed asserted values only; never recomputed */}
      <dl className="space-y-2">
        <div className="flex gap-2">
          <dt className="text-xs text-zinc-500 w-20 shrink-0">Commodity</dt>
          <dd className="text-xs text-white">{commodity}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="text-xs text-zinc-500 w-20 shrink-0">Quantity</dt>
          <dd className="text-xs text-white">
            {quantity} {unit}
            <span className="text-zinc-600 ml-2">(signed asserted value)</span>
          </dd>
        </div>
        {p.recipient !== null && (
          <div className="flex gap-2">
            <dt className="text-xs text-zinc-500 w-20 shrink-0">Recipient</dt>
            <dd className="text-xs text-white">{p.recipient}</dd>
          </div>
        )}
        <div className="flex gap-2">
          <dt className="text-xs text-zinc-500 w-20 shrink-0">Signed by</dt>
          <dd className="text-xs text-zinc-300 font-mono break-all">{actorDid}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="text-xs text-zinc-500 w-20 shrink-0">Date</dt>
          <dd className="text-xs text-zinc-300">{date}</dd>
        </div>
      </dl>

      {/* Provenance line ΓÇö cryptographic anchor, NOT a physical-world truth claim */}
      <div className="border-t border-zinc-800 pt-3 space-y-1.5">
        <p className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">
          Signed provenance
        </p>
        <p className="text-[10px] text-zinc-600 leading-relaxed break-all">
          Signed receipt ┬╖ attestation{' '}
          <span className="font-mono text-zinc-500">{attestationCid ?? 'ΓÇö'}</span>
          {priorCid !== null && (
            <>
              {' '}
              ┬╖ chained to declared{' '}
              <span className="font-mono text-zinc-500">{priorCid}</span>
            </>
          )}
        </p>
        <p className="text-[10px] text-zinc-700 italic">
          Provenance not verdict ΓÇö shows what was signed and by whom; not a claim of
          physical-world truth.
        </p>
      </div>

      {/* Manual resend (xprize#75) — only while the recipient hasn't yet countersigned; once bilateral, resending would just be noise. */}
      {settlement.state === 'pending-invoice' && <ResendNotification correlationId={lot.correlationId} />}

      <SettlementSection settlement={settlement} />
    </section>
  );
}
