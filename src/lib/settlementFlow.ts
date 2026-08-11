/**
 * Settlement orchestration (xprize#60) — the only place that calls
 * money-moving kernel endpoints. Every entry point re-validates bilateral
 * status and the frozen manifest total; nothing here trusts a caller's
 * claim that a receipt is ready.
 */

import { getLotChain, getLotChainAsSelf, type LotChain } from './supply';
import { isReceiptBilateral } from './kernel/attestations';
import { createQuickBooksInvoice } from './kernel/quickbooksInvoice';
import { createCheckoutSession } from './kernel/pay';
import { settleFair } from './kernel/pay';
import {
  validateReceiptForInvoicing,
  buildInvoiceLines,
  buildFairManifest,
  receiptTotalCents,
  type SettlementView,
} from './settlement';
import { getSettlementRecord, setSettlementRecord, tryClaimTransition } from './settlementStore';

// ---------------------------------------------------------------------------
// Step 1 — receipt -> invoice (gated on bilateral, called from an
// authenticated page view; see DeliveryReceipt.tsx and the xprize#60 issue
// comment for why a true kernel-reactor trigger isn't wired yet).
// ---------------------------------------------------------------------------

export interface InvoiceCreationDeps {
  quickbooksItemRef?: string;
  quickbooksCustomerRef?: string;
  appUrl?: string;
}

function resolveInvoicingConfig(deps: InvoiceCreationDeps): { itemRef: string; customerRef: string } | { error: string } {
  const itemRef = deps.quickbooksItemRef ?? process.env.QUICKBOOKS_DEFAULT_ITEM_REF;
  const customerRef = deps.quickbooksCustomerRef ?? process.env.QUICKBOOKS_DEFAULT_CUSTOMER_REF;
  if (!itemRef) {
    return { error: 'QUICKBOOKS_DEFAULT_ITEM_REF is not configured — refusing to guess a QBO item' };
  }
  if (!customerRef) {
    return { error: 'QUICKBOOKS_DEFAULT_CUSTOMER_REF is not configured — refusing to guess a QBO customer' };
  }
  return { itemRef, customerRef };
}

/**
 * Attempt to create the settlement invoice for a lot, once it is bilateral.
 * No-op (returns the current view unchanged) when:
 *   - the receipt is not yet bilateral,
 *   - an invoice/settlement attempt already exists for this correlationId,
 *   - the manifest fails the fail-closed validation (missing/zero total).
 */
export async function attemptInvoiceCreation(
  correlationId: string,
  attestationId: string,
  deps: InvoiceCreationDeps = {},
): Promise<SettlementView> {
  const existing = getSettlementRecord(correlationId);
  if (existing !== undefined && existing.state !== 'pending-invoice') {
    return { state: existing.state, invoiceId: existing.invoiceId, checkoutUrl: existing.checkoutUrl, error: existing.error };
  }

  let chain: LotChain;
  try {
    chain = await getLotChain(correlationId, attestationId);
  } catch {
    return { state: 'pending-invoice' };
  }

  if (chain.lot === null || chain.lot.status === 'settled') {
    return { state: chain.lot?.status === 'settled' ? 'settled' : 'pending-invoice' };
  }

  const supplierDid = chain.lot.originatingDid;
  const bilateral = await isReceiptBilateral(supplierDid, correlationId).catch(() => false);
  if (!bilateral) {
    return { state: 'pending-invoice' };
  }

  const validation = validateReceiptForInvoicing(chain);
  if (!validation.ok) {
    const view: SettlementView = { state: 'error', error: validation.reason };
    setSettlementRecord(correlationId, { state: 'error', error: validation.reason });
    return view;
  }

  const config = resolveInvoicingConfig(deps);
  if ('error' in config) {
    const view: SettlementView = { state: 'error', error: config.error };
    setSettlementRecord(correlationId, { state: 'error', error: config.error });
    return view;
  }

  if (!tryClaimTransition(correlationId, ['pending-invoice'], 'awaiting-payment')) {
    const record = getSettlementRecord(correlationId);
    return { state: record?.state ?? 'pending-invoice', invoiceId: record?.invoiceId, checkoutUrl: record?.checkoutUrl };
  }

  try {
    const invoiceLines = buildInvoiceLines(validation.lines, config.itemRef);
    const { invoice } = await createQuickBooksInvoice(
      { correlationId, customerRef: config.customerRef, lines: invoiceLines },
      attestationId,
    );

    const appUrl = (deps.appUrl ?? process.env.NEXT_PUBLIC_APP_URL ?? '').replace(/\/$/, '');
    const returnUrl = `${appUrl}/dashboard?lot=${encodeURIComponent(correlationId)}`;
    let checkoutUrl: string | undefined;
    try {
      const checkout = await createCheckoutSession(
        {
          items: [{ name: 'AgriFortress delivery settlement', amount: validation.totalCents, quantity: 1 }],
          currency: 'usd',
          successUrl: returnUrl,
          cancelUrl: returnUrl,
          metadata: { correlationId, supplierDid },
        },
        attestationId,
      );
      checkoutUrl = checkout.url;
    } catch {
      // Checkout link is optional — QBO-recorded payment is still a valid
      // ingress path (issue #60: "and/or direct payment recorded in QBO").
    }

    setSettlementRecord(correlationId, { state: 'awaiting-payment', invoiceId: invoice.id, checkoutUrl });
    return { state: 'awaiting-payment', invoiceId: invoice.id, checkoutUrl, totalCents: validation.totalCents };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    setSettlementRecord(correlationId, { state: 'error', error: message });
    return { state: 'error', error: message };
  }
}

// ---------------------------------------------------------------------------
// Step 3 — paid hook -> settle (Stripe checkout.session.completed ingress).
// The QBO ingress path settles automatically, kernel-side, once the
// per-supplier webhook is wired (xprize#35) — see the issue #60 comment for
// why this app does not also call /pay/api/settle for that path.
//
// A webhook delivery has no human session, so there is no per-user
// attestation to borrow (xprize#68). The lot read here uses
// `getLotChainAsSelf` — the app's own session-less `app-service+jwt`
// credential (ima-jin/imajin-ai#1800/#1802) — instead of any supplier's
// consent attestation.
// ---------------------------------------------------------------------------

export interface SettleFromStripeParams {
  correlationId: string;
  /** The payer/org DID — Stripe's checkout session carries no buyer DID by default. */
  fromDid: string;
}

export async function attemptSettleFromStripe(params: SettleFromStripeParams): Promise<SettlementView> {
  const { correlationId, fromDid } = params;

  const existing = getSettlementRecord(correlationId);
  if (existing?.state === 'settled') {
    return { state: 'settled', invoiceId: existing.invoiceId }; // idempotent no-op
  }

  let chain: LotChain;
  try {
    chain = await getLotChainAsSelf(correlationId);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { state: 'error', error: message };
  }

  if (chain.lot?.status === 'settled') {
    setSettlementRecord(correlationId, { state: 'settled', invoiceId: existing?.invoiceId });
    return { state: 'settled' }; // kernel-side QBO path already settled this lot
  }

  const supplierDid = chain.lot?.originatingDid;
  if (supplierDid === undefined) {
    return { state: 'error', error: 'lot not found for correlationId' };
  }

  const bilateral = await isReceiptBilateral(supplierDid, correlationId).catch(() => false);
  if (!bilateral) {
    return { state: 'error', error: 'refusing to settle — receipt is not bilateral' };
  }

  const validation = validateReceiptForInvoicing(chain);
  if (!validation.ok) {
    return { state: 'error', error: validation.reason };
  }

  if (!tryClaimTransition(correlationId, ['pending-invoice', 'awaiting-payment'], 'settled')) {
    return { state: 'settled' }; // another call already claimed the settle
  }

  try {
    const totalCents = receiptTotalCents(validation.lines);
    const fairManifest = buildFairManifest(supplierDid, totalCents);
    await settleFair({
      from_did: fromDid,
      total_amount: totalCents / 100,
      service: 'agrifortress-supply',
      type: 'supply.settlement',
      fair_manifest: fairManifest,
      funded: true,
      funded_provider: 'stripe',
      metadata: { correlationId },
      currency: 'USD',
    });
    setSettlementRecord(correlationId, { state: 'settled', invoiceId: existing?.invoiceId });
    return { state: 'settled', totalCents, invoiceId: existing?.invoiceId };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    setSettlementRecord(correlationId, { state: 'error', error: message });
    return { state: 'error', error: message };
  }
}
