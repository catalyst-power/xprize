/**
 * Settlement domain module (xprize#60) — pure helpers that gate real-money
 * actions on structural facts, never on convention.
 *
 * Money-moving steps in this app must never rely on "we always call this
 * after bilateral" as the safety net — every entry point re-checks the
 * bilateral attestation status and the frozen manifest total before it
 * builds an invoice or a settlement request.
 */

import type { AttestationRecord } from './kernel/attestations';
import type { LotChain, LotChainStage } from './supply';
import type { CreateInvoiceLine } from './kernel/quickbooksInvoice';
import type { FairManifest } from './kernel/pay';

// ---------------------------------------------------------------------------
// Bilateral gate
// ---------------------------------------------------------------------------

/**
 * True only when a `supply.received` attestation for this exact lot
 * (`contextId === correlationId`) is bilateral. Never infers bilateral-ness
 * from `lot.status` (which only ever reaches 'received'/'settled' — the
 * kernel's supply-lots projection has no notion of attestation-level
 * countersignature at all; see `src/lib/kernel/attestations.ts`).
 */
export function isBilateralReceipt(
  attestations: readonly AttestationRecord[],
  correlationId: string,
): boolean {
  return attestations.some(
    (a) => a.type === 'supply.received' && a.contextId === correlationId && a.attestationStatus === 'bilateral',
  );
}

// ---------------------------------------------------------------------------
// Frozen packing-slip line extraction (from the signed `received` stage)
// ---------------------------------------------------------------------------

export interface ReceiptLine {
  product: string;
  qty: number;
  unit: string;
  /** Integer cents. */
  total: number;
}

/**
 * Extract the frozen packing-slip lines the supplier actually signed, from
 * the `received` stage's payload. Returns `[]` when the payload doesn't
 * carry a `lines` array (e.g. the legacy single-product shape, or a receipt
 * signed before xprize#56) — callers must fail closed on an empty result
 * rather than guessing a total.
 */
export function extractReceiptLines(stage: LotChainStage): ReceiptLine[] {
  const payload = stage.payload;
  if (typeof payload !== 'object' || payload === null) return [];
  const rawLines = (payload as Record<string, unknown>)['lines'];
  if (!Array.isArray(rawLines)) return [];

  const lines: ReceiptLine[] = [];
  for (const raw of rawLines) {
    if (typeof raw !== 'object' || raw === null) continue;
    const r = raw as Record<string, unknown>;
    const product = r['product'];
    const qty = r['qty'];
    const unit = r['unit'];
    const total = r['total'];
    const productLabel =
      typeof product === 'object' && product !== null
        ? (product as Record<string, unknown>)['label']
        : product;
    if (
      typeof productLabel !== 'string' ||
      typeof qty !== 'number' ||
      typeof unit !== 'string' ||
      typeof total !== 'number'
    ) {
      continue;
    }
    lines.push({ product: productLabel, qty, unit, total });
  }
  return lines;
}

/** Sum of every line's total (cents). Zero for an empty/malformed manifest. */
export function receiptTotalCents(lines: readonly ReceiptLine[]): number {
  return lines.reduce((sum, line) => sum + line.total, 0);
}

// ---------------------------------------------------------------------------
// Fail-closed manifest validation (xprize#58 guard)
// ---------------------------------------------------------------------------

export interface ReceiptValidationError {
  ok: false;
  reason: string;
}

export interface ReceiptValidationOk {
  ok: true;
  lines: ReceiptLine[];
  totalCents: number;
}

export type ReceiptValidationResult = ReceiptValidationOk | ReceiptValidationError;

/**
 * Validate a lot chain is ready for invoice creation: has a `received`
 * stage, that stage carries at least one line, and the manifest total is
 * strictly positive. Fails closed (never creates an invoice for $0 or a
 * missing manifest — xprize#58's bug class).
 */
export function validateReceiptForInvoicing(chain: LotChain): ReceiptValidationResult {
  const stage = chain.stages.find((s) => s.stage === 'received');
  if (stage === undefined) {
    return { ok: false, reason: 'no received stage on this lot yet' };
  }

  const lines = extractReceiptLines(stage);
  if (lines.length === 0) {
    return { ok: false, reason: 'received stage has no packing-slip lines to invoice' };
  }

  const totalCents = receiptTotalCents(lines);
  if (totalCents <= 0) {
    return { ok: false, reason: 'manifest total is zero — refusing to create a $0 invoice (xprize#58)' };
  }

  return { ok: true, lines, totalCents };
}

// ---------------------------------------------------------------------------
// QuickBooks invoice line construction
// ---------------------------------------------------------------------------

/**
 * Map frozen packing-slip lines to QBO invoice lines. `itemRef` is a single
 * QBO catalog Item shared across every line — the kernel has no
 * product-catalog -> QBO-item resolver yet, so a per-product mapping isn't
 * possible from the app side (documented follow-up, xprize#60 issue comment).
 */
export function buildInvoiceLines(lines: readonly ReceiptLine[], itemRef: string): CreateInvoiceLine[] {
  return lines.map((line) => ({
    amount: line.total / 100,
    itemRef,
    description: `${line.product} (${line.qty} ${line.unit})`,
    quantity: line.qty,
    unitPrice: line.qty > 0 ? line.total / 100 / line.qty : undefined,
  }));
}

// ---------------------------------------------------------------------------
// .fair manifest construction for the direct-settle path (Stripe ingress)
// ---------------------------------------------------------------------------

/**
 * Minimal single-recipient `.fair` manifest: the supplier receives the full
 * receipt total. No platform/fee split is defined for AgriFortress today —
 * add chain entries here if/when one is introduced.
 */
export function buildFairManifest(supplierDid: string, totalAmountCents: number): FairManifest {
  return { chain: [{ did: supplierDid, amount: totalAmountCents / 100, role: 'seller' }] };
}

// ---------------------------------------------------------------------------
// Settlement state — surfaced by the app, not authoritative on the kernel
// ---------------------------------------------------------------------------

export type SettlementState = 'pending-invoice' | 'awaiting-payment' | 'settled' | 'error';

export interface SettlementView {
  state: SettlementState;
  invoiceId?: string;
  checkoutUrl?: string;
  totalCents?: number;
  error?: string;
}
