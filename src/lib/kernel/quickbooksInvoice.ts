/** QuickBooks invoice client for the public kernel connector surface (xprize#60). */

import { fetchKernel } from './client';

const QUICKBOOKS_INVOICE_PATH = '/quickbooks/api/invoice';

export interface CreateInvoiceLine {
  /** Dollars, not cents — kernel passes this to QBO Invoice.Line[].Amount. */
  amount: number;
  /** QBO ItemRef.value. Until the kernel resolves products to QBO items, this comes from env. */
  itemRef: string;
  description?: string;
  quantity?: number;
  unitPrice?: number;
}

export interface CreateQuickBooksInvoiceRequest {
  /** Delivery lot correlationId, stamped into QBO PrivateNote as `imajin-lot:{correlationId}`. */
  correlationId: string;
  /** QBO CustomerRef.value. Until the kernel resolves buyer DID -> QBO customer, this comes from env/config. */
  customerRef: string;
  lines: CreateInvoiceLine[];
  /** Buyer/org DID; kernel persists it on the supply-lot projection for settlement. */
  buyerDid?: string;
}

export interface QuickBooksInvoice {
  id: string;
  docNumber: string | null;
  customerName: string | null;
  totalAmount: number;
  balance: number | null;
  currency: string | null;
  txnDate: string | null;
  correlationId: string | null;
}

export interface CreateQuickBooksInvoiceResponse {
  invoice: QuickBooksInvoice;
  fairManifest: unknown;
}

export async function createQuickBooksInvoice(
  body: CreateQuickBooksInvoiceRequest,
  attestationId: string,
): Promise<CreateQuickBooksInvoiceResponse> {
  const res = await fetchKernel(
    QUICKBOOKS_INVOICE_PATH,
    { method: 'POST', body: JSON.stringify(body) },
    attestationId,
  );

  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: res.statusText })) as { error?: string };
    throw new Error(`quickbooks.invoice.create failed: ${res.status} ${data.error ?? res.statusText}`);
  }

  return res.json() as Promise<CreateQuickBooksInvoiceResponse>;
}
